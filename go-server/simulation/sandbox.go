package simulation

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// Sandbox is a 3D space where agents live and move.
type Sandbox struct {
	Width       float64                `json:"width"`  // X extent
	Height      float64                `json:"height"` // Y extent
	Depth       float64                `json:"depth"`  // Z extent
	Agents      []*Agent               `json:"agents"`
	Objects     []*PhysicalObject      `json:"objects"`
	SpawnPoints map[string]*SpawnPoint `json:"spawnPoints"`

	TickRate  time.Duration // how often the simulation ticks
	StepSize  float64       // retained for compatibility; not used in circular motion
	tick      uint64
	mu        sync.RWMutex
	listeners []chan SandboxState
	stop      chan struct{}
	planner   *GridPathPlanner
}

// SandboxState is a snapshot sent to listeners each tick.
type SandboxState struct {
	Tick    uint64            `json:"tick"`
	Agents  []*Agent          `json:"agents"`
	Objects []*PhysicalObject `json:"objects"`
}

// NewSandbox creates a sandbox with given dimensions.
func NewSandbox(width, height, depth float64) *Sandbox {
	return &Sandbox{
		Width:       width,
		Height:      height,
		Depth:       depth,
		Agents:      make([]*Agent, 0),
		Objects:     make([]*PhysicalObject, 0),
		SpawnPoints: make(map[string]*SpawnPoint),
		TickRate:    16 * time.Millisecond,
		StepSize:    0.5,
		stop:        make(chan struct{}),
		planner:     NewGridPathPlanner(),
	}
}

// AddSpawnPoint registers a named spawn point.
func (s *Sandbox) AddSpawnPoint(sp *SpawnPoint) error {
	if sp == nil {
		return fmt.Errorf("spawn point is nil")
	}
	id := strings.TrimSpace(sp.ID)
	if id == "" {
		return fmt.Errorf("spawn point id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.SpawnPoints[id]; exists {
		return fmt.Errorf("spawn point %q already exists", id)
	}
	s.SpawnPoints[id] = &SpawnPoint{ID: id, Position: sp.Position}
	return nil
}

// SpawnPointByID returns a spawn point by id.
func (s *Sandbox) SpawnPointByID(id string) (*SpawnPoint, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sp, ok := s.SpawnPoints[strings.TrimSpace(id)]
	if !ok {
		return nil, false
	}
	return &SpawnPoint{ID: sp.ID, Position: sp.Position}, true
}

// SpawnOrbitAgentFromPoint creates and adds an orbit agent at the given spawn point.
func (s *Sandbox) SpawnOrbitAgentFromPoint(spawnPointID, agentID string, friendly bool, enemy bool) error {
	id := strings.TrimSpace(spawnPointID)
	if id == "" {
		return fmt.Errorf("spawn point id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	sp, ok := s.SpawnPoints[id]
	if !ok {
		return fmt.Errorf("spawn point %q not found", id)
	}

	agent := NewOrbitAgent(agentID, friendly, enemy, sp.Position)
	s.Agents = append(s.Agents, agent)
	return nil
}

// AddAgent adds an agent to the sandbox.
func (s *Sandbox) AddAgent(a *Agent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Agents = append(s.Agents, a)
}

// AddObject adds a static physical object to the sandbox.
func (s *Sandbox) AddObject(o *PhysicalObject) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Objects = append(s.Objects, o)
}

// Subscribe returns a channel that receives state snapshots each tick.
func (s *Sandbox) Subscribe() chan SandboxState {
	ch := make(chan SandboxState, 1)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listeners = append(s.listeners, ch)
	return ch
}

// Unsubscribe removes a listener channel.
func (s *Sandbox) Unsubscribe(ch chan SandboxState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, l := range s.listeners {
		if l == ch {
			s.listeners = append(s.listeners[:i], s.listeners[i+1:]...)
			close(ch)
			return
		}
	}
}

// Run starts the tick loop. Blocks until Stop() is called.
func (s *Sandbox) Run() {
	ticker := time.NewTicker(s.TickRate)
	defer ticker.Stop()
	lastTickTime := time.Now()

	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			now := time.Now()
			deltaSeconds := now.Sub(lastTickTime).Seconds()
			lastTickTime = now
			s.tick++
			s.mu.Lock()

			// Build id index for cross-agent lookups.
			agentsByID := make(map[string]*Agent, len(s.Agents))
			for _, a := range s.Agents {
				agentsByID[a.ID] = a
				s.applyObjectiveStackPolicy(a)
			}

			// 1) Update orbiters first, so tails read current target state.
			for _, a := range s.Agents {
				if a.Behavior == "orbit" {
					a.StepCircle(deltaSeconds)
				}
			}

			// 2) Update tailers using (possibly updated) target transforms.
			for _, a := range s.Agents {
				if a.Behavior == "tail" {
					target := agentsByID[a.FollowID]
					a.StepTail(target, deltaSeconds)
				}
			}

			// 3) Update explicit move commands.
			for _, a := range s.Agents {
				if a.Behavior == "move_to" {
					a.StepMoveTo(deltaSeconds)
				}
			}

			// 4) Any unknown or empty behavior is held stationary.
			for _, a := range s.Agents {
				if a.Behavior == "" && a.HasQueuedObjectives() {
					s.activateNextObjective(a)
				}

				switch a.Behavior {
				case "orbit", "tail", "move_to":
					// handled above
				default:
					a.HoldStationary()
				}
			}

			s.destroyAgentsCollidingWithObjects()

			// Build snapshot
			state := SandboxState{
				Tick:    s.tick,
				Agents:  s.Agents,
				Objects: s.Objects,
			}

			// Broadcast to listeners (non-blocking)
			for _, ch := range s.listeners {
				select {
				case ch <- state:
				default:
					// drop if listener is slow
				}
			}

			s.mu.Unlock()
		}
	}
}

func (s *Sandbox) destroyAgentsCollidingWithObjects() {
	if len(s.Objects) == 0 || len(s.Agents) == 0 {
		return
	}

	alive := make([]*Agent, 0, len(s.Agents))
	for _, a := range s.Agents {
		collided := false
		for _, obj := range s.Objects {
			if collidesWithObject(a.Position, obj) {
				collided = true
				break
			}
		}
		if !collided {
			alive = append(alive, a)
		}
	}

	s.Agents = alive
}

// MoveAgentTo computes a path and commands an agent to move to destination.
func (s *Sandbox) MoveAgentTo(agentID string, destination Vector3) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var target *Agent
	for _, a := range s.Agents {
		if a.ID == agentID {
			target = a
			break
		}
	}
	if target == nil {
		return fmt.Errorf("agent %q not found", agentID)
	}

	target.EnqueueInstructionMoveObjective(destination, s.tick)
	if target.Behavior != "move_to" {
		s.activateNextObjective(target)
	}
	return nil
}

func (s *Sandbox) activateNextObjective(target *Agent) {
	next, ok := target.NextQueuedObjective()
	if !ok {
		return
	}

	blocked := make([]Vector3, 0, len(s.Agents)-1)
	for _, a := range s.Agents {
		if a.ID == target.ID {
			continue
		}
		blocked = append(blocked, a.Position)
	}

	path := s.planner.FindPath(target.Position, next.Target, s.Width, s.Depth, blocked)
	if len(path) == 0 {
		path = []Vector3{next.Target}
	}
	_ = target.ActivateNextObjective(path)
}

func (s *Sandbox) applyObjectiveStackPolicy(a *Agent) {
	target, atRisk := s.selfPreservationTarget(a)
	if !atRisk {
		return
	}

	if a.ActiveObjective != nil && a.ActiveObjective.Kind == ObjectiveKindSelfPreservation {
		return
	}

	if a.ActiveObjective != nil && a.ActiveObjective.Kind == ObjectiveKindFollowInstruction && a.MoveGoal != nil {
		// Re-queue interrupted instruction objective so it can resume after safety objective.
		a.EnqueueInstructionMoveObjective(*a.MoveGoal, s.tick)
	}

	if !a.hasQueuedObjectiveKind(ObjectiveKindSelfPreservation) {
		a.EnqueueObjective(ObjectiveKindSelfPreservation, target, ObjectivePrioritySelfPreservation, s.tick)
	}

	nextPriority, hasNext := a.nextQueuedObjectivePriority()
	if hasNext {
		currentPriority := ObjectivePriorityFollowInstruction + 100
		if a.ActiveObjective != nil {
			currentPriority = a.ActiveObjective.Priority
		}
		if a.Behavior != "move_to" || nextPriority < currentPriority {
			s.activateNextObjective(a)
		}
	}
}

func (s *Sandbox) selfPreservationTarget(a *Agent) (Vector3, bool) {
	margin := 1.0
	halfW := s.Width / 2
	halfD := s.Depth / 2

	target := a.Position
	atRisk := false

	safeX := halfW - margin
	if a.Position.X > safeX {
		target.X = safeX
		atRisk = true
	}
	if a.Position.X < -safeX {
		target.X = -safeX
		atRisk = true
	}

	safeY := s.Height - margin
	if a.Position.Y > safeY {
		target.Y = safeY
		atRisk = true
	}
	if a.Position.Y < 0 {
		target.Y = 0
		atRisk = true
	}

	safeZ := halfD - margin
	if a.Position.Z > safeZ {
		target.Z = safeZ
		atRisk = true
	}
	if a.Position.Z < -safeZ {
		target.Z = -safeZ
		atRisk = true
	}

	return target, atRisk
}

// SetAgentBehavior updates an agent behavior at runtime.
func (s *Sandbox) SetAgentBehavior(agentID string, behavior string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	behavior = strings.ToLower(strings.TrimSpace(behavior))
	if behavior != "orbit" && behavior != "stationary" {
		return fmt.Errorf("unsupported behavior %q", behavior)
	}

	for _, a := range s.Agents {
		if a.ID == agentID {
			a.SetBehavior(behavior)
			return nil
		}
	}

	return fmt.Errorf("agent %q not found", agentID)
}

// Reset places all agents back at initial state and resets tick counter.
func (s *Sandbox) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tick = 0
	for _, a := range s.Agents {
		a.Reset()
	}
}

// Stop halts the tick loop.
func (s *Sandbox) Stop() {
	close(s.stop)
}
