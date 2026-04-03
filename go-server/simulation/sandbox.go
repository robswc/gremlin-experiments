package simulation

import (
	"fmt"
	"math"
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
	Roads       []*Road                `json:"roads"`
	Paths       []*Path                `json:"paths"`
	Fleets      []*Fleet               `json:"fleets"`
	SpawnPoints map[string]*SpawnPoint `json:"spawnPoints"`

	TickRate    time.Duration // how often the simulation ticks
	StepSize    float64       // retained for compatibility; not used in circular motion
	tick        uint64
	mu          sync.RWMutex
	listeners   []chan SandboxState
	stop        chan struct{}
	planner     *GridPathPlanner
	nextFleetID uint64
}

// SandboxState is a snapshot sent to listeners each tick.
type SandboxState struct {
	Tick    uint64            `json:"tick"`
	Agents  []*Agent          `json:"agents"`
	Objects []*PhysicalObject `json:"objects"`
	Roads   []*Road           `json:"roads"`
	Paths   []*Path           `json:"paths"`
	Fleets  []*Fleet          `json:"fleets"`
}

// NewSandbox creates a sandbox with given dimensions.
func NewSandbox(width, height, depth float64) *Sandbox {
	return &Sandbox{
		Width:       width,
		Height:      height,
		Depth:       depth,
		Agents:      make([]*Agent, 0),
		Objects:     make([]*PhysicalObject, 0),
		Roads:       make([]*Road, 0),
		Paths:       make([]*Path, 0),
		Fleets:      make([]*Fleet, 0),
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

// AddRoad adds a static road path to the sandbox.
func (s *Sandbox) AddRoad(r *Road) {
	if r == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.Roads = append(s.Roads, r)
}

// AddPath adds a reusable path route to the sandbox.
func (s *Sandbox) AddPath(p *Path) {
	if p == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.Paths = append(s.Paths, p)
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
			s.syncFleetFollowerBehaviorLocked(agentsByID)

			// 1) Update orbiters first, so tails read current target state.
			for _, a := range s.Agents {
				if a.Behavior == "orbit" {
					a.StepCircle(deltaSeconds)
				}
			}

			// 2) Update explicit move commands.
			for _, a := range s.Agents {
				if a.Behavior == "move_to" {
					a.StepMoveTo(deltaSeconds)
				}
			}

			// 3) Update assigned path followers.
			for _, a := range s.Agents {
				if a.Behavior == "path" {
					a.StepAssignedPath(deltaSeconds)
				}
			}

			// 4) Update fleet followers using current target transforms.
			for _, a := range s.Agents {
				if a.Behavior == "follow" {
					target := agentsByID[a.FollowID]
					a.StepFollow(target, deltaSeconds)
				}
			}

			// 5) Update tailers using (possibly updated) target transforms.
			for _, a := range s.Agents {
				if a.Behavior == "tail" {
					target := agentsByID[a.FollowID]
					a.StepTail(target, deltaSeconds)
				}
			}

			// 6) Any unknown or empty behavior is held stationary.
			for _, a := range s.Agents {
				if a.Behavior == "" && a.HasQueuedObjectives() {
					s.activateNextObjective(a)
				}

				switch a.Behavior {
				case "orbit", "follow", "tail", "move_to", "path":
					// handled above
				default:
					a.HoldStationary()
				}
			}

			s.enforceAgentSpacingLocked(1.0)

			s.destroyAgentsCollidingWithObjects()

			// Build snapshot
			state := SandboxState{
				Tick:    s.tick,
				Agents:  s.Agents,
				Objects: s.Objects,
				Roads:   s.Roads,
				Paths:   s.Paths,
				Fleets:  s.Fleets,
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

func (s *Sandbox) enforceAgentSpacingLocked(minDistance float64) {
	if len(s.Agents) < 2 || minDistance <= 0 {
		return
	}

	minDistSq := minDistance * minDistance
	for i := 0; i < len(s.Agents); i++ {
		for j := i + 1; j < len(s.Agents); j++ {
			a := s.Agents[i]
			b := s.Agents[j]

			dx := b.Position.X - a.Position.X
			dy := b.Position.Y - a.Position.Y
			dz := b.Position.Z - a.Position.Z
			distSq := dx*dx + dy*dy + dz*dz
			if distSq >= minDistSq {
				continue
			}

			if distSq < 1e-9 {
				dx = 1
				dy = 0
				dz = 0
				distSq = 1
			}

			dist := math.Sqrt(distSq)
			overlap := minDistance - dist
			if overlap <= 0 {
				continue
			}

			nx := dx / dist
			ny := dy / dist
			nz := dz / dist
			correction := overlap * 0.5

			a.Position.X -= nx * correction
			a.Position.Y -= ny * correction
			a.Position.Z -= nz * correction
			b.Position.X += nx * correction
			b.Position.Y += ny * correction
			b.Position.Z += nz * correction

			a.Position.X = clamp(a.Position.X, -(s.Width / 2), s.Width/2)
			a.Position.Y = clamp(a.Position.Y, 0, s.Height)
			a.Position.Z = clamp(a.Position.Z, -(s.Depth / 2), s.Depth/2)
			b.Position.X = clamp(b.Position.X, -(s.Width / 2), s.Width/2)
			b.Position.Y = clamp(b.Position.Y, 0, s.Height)
			b.Position.Z = clamp(b.Position.Z, -(s.Depth / 2), s.Depth/2)
		}
	}
}

func (s *Sandbox) syncFleetFollowerBehaviorLocked(agentsByID map[string]*Agent) {
	for _, fleet := range s.Fleets {
		leader := agentsByID[fleet.LeaderID]
		if leader == nil {
			continue
		}

		for _, memberID := range fleet.AgentIDs {
			if memberID == fleet.LeaderID {
				continue
			}
			member := agentsByID[memberID]
			if member == nil {
				continue
			}

			member.FollowID = fleet.LeaderID
			if member.Behavior != "move_to" {
				member.Behavior = "follow"
			}
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
	s.reconcileFleetsForCurrentEntitiesLocked()
}

// UpsertFleet creates or updates a fleet.
func (s *Sandbox) UpsertFleet(id string, name string, leaderID string, agentIDs []string, objectIDs []string) (*Fleet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id = strings.TrimSpace(id)
	name = strings.TrimSpace(name)
	leaderID = strings.TrimSpace(leaderID)
	if name == "" {
		return nil, fmt.Errorf("fleet name is required")
	}
	if leaderID == "" {
		return nil, fmt.Errorf("leaderId is required")
	}

	agentIDs = normalizeIDList(agentIDs)
	objectIDs = normalizeIDList(objectIDs)

	agentSet := make(map[string]struct{}, len(s.Agents))
	for _, a := range s.Agents {
		agentSet[a.ID] = struct{}{}
	}

	if _, exists := agentSet[leaderID]; !exists {
		return nil, fmt.Errorf("leader agent %q not found", leaderID)
	}

	for _, agentID := range agentIDs {
		if _, exists := agentSet[agentID]; !exists {
			return nil, fmt.Errorf("fleet agent %q not found", agentID)
		}
	}

	leaderIncluded := false
	for _, agentID := range agentIDs {
		if agentID == leaderID {
			leaderIncluded = true
			break
		}
	}
	if !leaderIncluded {
		agentIDs = append([]string{leaderID}, agentIDs...)
	}

	objectSet := make(map[string]struct{}, len(s.Objects))
	for _, object := range s.Objects {
		objectSet[object.ID] = struct{}{}
	}
	for _, objectID := range objectIDs {
		if _, exists := objectSet[objectID]; !exists {
			return nil, fmt.Errorf("fleet object %q not found", objectID)
		}
	}

	for _, fleet := range s.Fleets {
		if fleet.LeaderID == leaderID && fleet.ID != id {
			return nil, fmt.Errorf("leader %q is already assigned to fleet %q", leaderID, fleet.ID)
		}
	}

	if id == "" {
		s.nextFleetID++
		id = fmt.Sprintf("fleet-%d", s.nextFleetID)
		fleet := &Fleet{
			ID:        id,
			Name:      name,
			LeaderID:  leaderID,
			AgentIDs:  agentIDs,
			ObjectIDs: objectIDs,
		}
		s.Fleets = append(s.Fleets, fleet)
		return fleet, nil
	}

	for _, fleet := range s.Fleets {
		if fleet.ID != id {
			continue
		}
		fleet.Name = name
		fleet.LeaderID = leaderID
		fleet.AgentIDs = agentIDs
		fleet.ObjectIDs = objectIDs
		return fleet, nil
	}

	fleet := &Fleet{
		ID:        id,
		Name:      name,
		LeaderID:  leaderID,
		AgentIDs:  agentIDs,
		ObjectIDs: objectIDs,
	}
	s.Fleets = append(s.Fleets, fleet)
	return fleet, nil
}

// DeleteFleet removes a fleet by id.
func (s *Sandbox) DeleteFleet(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("fleet id is required")
	}

	for i, fleet := range s.Fleets {
		if fleet.ID != id {
			continue
		}
		s.Fleets = append(s.Fleets[:i], s.Fleets[i+1:]...)
		return nil
	}

	return fmt.Errorf("fleet %q not found", id)
}

func (s *Sandbox) reconcileFleetsForCurrentEntitiesLocked() {
	if len(s.Fleets) == 0 {
		return
	}

	agentSet := make(map[string]struct{}, len(s.Agents))
	for _, agent := range s.Agents {
		agentSet[agent.ID] = struct{}{}
	}

	objectSet := make(map[string]struct{}, len(s.Objects))
	for _, object := range s.Objects {
		objectSet[object.ID] = struct{}{}
	}

	kept := make([]*Fleet, 0, len(s.Fleets))
	for _, fleet := range s.Fleets {
		if _, leaderAlive := agentSet[fleet.LeaderID]; !leaderAlive {
			continue
		}

		agents := make([]string, 0, len(fleet.AgentIDs))
		leaderIncluded := false
		for _, agentID := range fleet.AgentIDs {
			if _, ok := agentSet[agentID]; !ok {
				continue
			}
			if agentID == fleet.LeaderID {
				leaderIncluded = true
			}
			agents = append(agents, agentID)
		}
		if !leaderIncluded {
			agents = append([]string{fleet.LeaderID}, agents...)
		}

		objects := make([]string, 0, len(fleet.ObjectIDs))
		for _, objectID := range fleet.ObjectIDs {
			if _, ok := objectSet[objectID]; ok {
				objects = append(objects, objectID)
			}
		}

		fleet.AgentIDs = normalizeIDList(agents)
		fleet.ObjectIDs = normalizeIDList(objects)
		kept = append(kept, fleet)
	}

	s.Fleets = kept
}

// MoveAgentTo computes a path and commands an agent to move to destination.
func (s *Sandbox) MoveAgentTo(agentID string, destination Vector3) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var target *Agent
	for _, a := range s.Agents {
		if a.ID == agentID {
			target = a
		}
	}
	if target == nil {
		return fmt.Errorf("agent %q not found", agentID)
	}
	if s.planner.blocksPoint(destination, s.Objects) {
		return fmt.Errorf("destination is blocked by a physical object")
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

	path, ok := s.planner.FindPath(target.Position, next.Target, s.Width, s.Depth, s.Objects)
	if !ok {
		return
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

// AssignPathToAgent attaches a reusable path to an agent.
// mode must be "once" or "repeat".
func (s *Sandbox) AssignPathToAgent(agentID, pathID, mode string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	repeat := false
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "once":
		repeat = false
	case "repeat":
		repeat = true
	default:
		return fmt.Errorf("unsupported path mode %q (expected once or repeat)", mode)
	}

	var targetPath *Path
	for _, p := range s.Paths {
		if p.ID == pathID {
			targetPath = p
			break
		}
	}
	if targetPath == nil {
		return fmt.Errorf("path %q not found", pathID)
	}
	if len(targetPath.Points) == 0 {
		return fmt.Errorf("path %q has no points", pathID)
	}

	for _, a := range s.Agents {
		if a.ID == agentID {
			a.AssignPath(targetPath.ID, targetPath.Points, repeat)
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
