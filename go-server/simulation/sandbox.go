package simulation

import (
	"sync"
	"time"
)

// Sandbox is a 3D space where agents live and move.
type Sandbox struct {
	Width  float64  `json:"width"`  // X extent
	Height float64  `json:"height"` // Y extent
	Depth  float64  `json:"depth"`  // Z extent
	Agents []*Agent `json:"agents"`

	TickRate  time.Duration // how often the simulation ticks
	StepSize  float64       // retained for compatibility; not used in circular motion
	tick      uint64
	mu        sync.RWMutex
	listeners []chan SandboxState
	stop      chan struct{}
}

// SandboxState is a snapshot sent to listeners each tick.
type SandboxState struct {
	Tick   uint64   `json:"tick"`
	Agents []*Agent `json:"agents"`
}

// NewSandbox creates a sandbox with given dimensions.
func NewSandbox(width, height, depth float64) *Sandbox {
	return &Sandbox{
		Width:    width,
		Height:   height,
		Depth:    depth,
		Agents:   make([]*Agent, 0),
		TickRate: 16 * time.Millisecond,
		StepSize: 0.5,
		stop:     make(chan struct{}),
	}
}

// AddAgent adds an agent to the sandbox.
func (s *Sandbox) AddAgent(a *Agent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Agents = append(s.Agents, a)
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

			// Move each agent in a smooth circle.
			agentsByID := make(map[string]*Agent, len(s.Agents))
			for _, a := range s.Agents {
				agentsByID[a.ID] = a
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

			// Build snapshot
			state := SandboxState{
				Tick:   s.tick,
				Agents: s.Agents,
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
