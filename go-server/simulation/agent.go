package simulation

import (
	"math"
	"math/rand"
)

// Vector3 represents a position in 3D space.
type Vector3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// Orientation describes full 3D rotation in radians.
type Orientation struct {
	Pitch float64 `json:"pitch"`
	Yaw   float64 `json:"yaw"`
	Roll  float64 `json:"roll"`
}

// Agent is an object that exists and moves within a Sandbox.
type Agent struct {
	ID          string      `json:"id"`
	Friendly    bool        `json:"friendly"`
	Enemy       bool        `json:"enemy"`
	Behavior    string      `json:"behavior"`
	FollowID    string      `json:"followId,omitempty"`
	Position    Vector3     `json:"position"`
	Orientation Orientation `json:"orientation"`

	orbitCenter Vector3
	orbitRadius float64
	orbitAngle  float64
	orbitSpeed  float64 // radians per second

	followDistance    float64
	followSpeed       float64
	followGoal        Vector3
	desiredYaw        float64
	turnRate          float64 // radians per second
	correctionTimer   float64
	minCorrectionWait float64
	maxCorrectionWait float64
}

// NewOrbitAgent creates an orbiting agent.
func NewOrbitAgent(id string, friendly bool, enemy bool, center Vector3) *Agent {
	return &Agent{
		ID:          id,
		Friendly:    friendly,
		Enemy:       enemy,
		Behavior:    "orbit",
		Position:    center,
		Orientation: Orientation{Pitch: 0, Yaw: 0, Roll: 0},
		orbitCenter: center,
		orbitRadius: 4,
		orbitAngle:  0,
		orbitSpeed:  0.8,
	}
}

// NewTailAgent creates a tailing agent that follows behind a target.
func NewTailAgent(id string, friendly bool, enemy bool, center Vector3, followID string) *Agent {
	a := &Agent{
		ID:                id,
		Friendly:          friendly,
		Enemy:             enemy,
		Behavior:          "tail",
		FollowID:          followID,
		Position:          center,
		Orientation:       Orientation{Pitch: 0, Yaw: 0, Roll: 0},
		orbitCenter:       center,
		followDistance:    2.5,
		followSpeed:       5.0,
		followGoal:        center,
		desiredYaw:        0,
		turnRate:          2.8,
		minCorrectionWait: 0.08,
		maxCorrectionWait: 0.45,
	}
	a.correctionTimer = a.nextCorrectionDelay()
	return a
}

// NewAgent kept for compatibility; defaults to orbit behavior.
func NewAgent(id string, friendly bool, enemy bool, center Vector3) *Agent {
	return NewOrbitAgent(id, friendly, enemy, center)
}

// StepCircle advances the agent along a circular path on the XZ floor plane.
func (a *Agent) StepCircle(deltaSeconds float64) {
	a.orbitAngle += a.orbitSpeed * deltaSeconds
	a.Position.X = a.orbitCenter.X + math.Cos(a.orbitAngle)*a.orbitRadius
	a.Position.Y = a.orbitCenter.Y
	a.Position.Z = a.orbitCenter.Z + math.Sin(a.orbitAngle)*a.orbitRadius

	// Face tangent direction so renderers can display heading.
	a.Orientation.Yaw = a.orbitAngle + (math.Pi / 2)
	a.Orientation.Pitch = 0
	a.Orientation.Roll = 0
}

// StepTail follows behind the target and only refreshes follow-goal after random delays.
func (a *Agent) StepTail(target *Agent, deltaSeconds float64) {
	if target == nil {
		return
	}

	a.correctionTimer -= deltaSeconds
	if a.correctionTimer <= 0 {
		forwardX := math.Cos(target.Orientation.Yaw)
		forwardZ := math.Sin(target.Orientation.Yaw)

		a.followGoal = Vector3{
			X: target.Position.X - forwardX*a.followDistance,
			Y: target.Position.Y,
			Z: target.Position.Z - forwardZ*a.followDistance,
		}
		a.desiredYaw = math.Atan2(a.followGoal.Z-a.Position.Z, a.followGoal.X-a.Position.X)
		a.correctionTimer = a.nextCorrectionDelay()
	}

	// Orientation correction lags behind via limited turn rate.
	yawDelta := normalizeAngle(a.desiredYaw - a.Orientation.Yaw)
	maxTurn := a.turnRate * deltaSeconds
	if yawDelta > maxTurn {
		yawDelta = maxTurn
	} else if yawDelta < -maxTurn {
		yawDelta = -maxTurn
	}
	a.Orientation.Yaw = normalizeAngle(a.Orientation.Yaw + yawDelta)

	// Translation speed is always constant.
	step := a.followSpeed * deltaSeconds
	forwardX := math.Cos(a.Orientation.Yaw)
	forwardZ := math.Sin(a.Orientation.Yaw)
	a.Position.X += forwardX * step
	a.Position.Z += forwardZ * step
	a.Position.Y = a.orbitCenter.Y

	a.Orientation.Pitch = 0
	a.Orientation.Roll = 0
}

func normalizeAngle(angle float64) float64 {
	for angle > math.Pi {
		angle -= 2 * math.Pi
	}
	for angle < -math.Pi {
		angle += 2 * math.Pi
	}
	return angle
}

func (a *Agent) nextCorrectionDelay() float64 {
	span := a.maxCorrectionWait - a.minCorrectionWait
	if span <= 0 {
		return a.minCorrectionWait
	}
	return a.minCorrectionWait + rand.Float64()*span
}

// Reset places the agent at the origin with zero orientation and restarts orbit phase.
func (a *Agent) Reset() {
	a.Position = a.orbitCenter
	a.Orientation = Orientation{Pitch: 0, Yaw: 0, Roll: 0}
	a.orbitAngle = 0
	a.followGoal = a.orbitCenter
	a.desiredYaw = 0
	a.correctionTimer = a.nextCorrectionDelay()
}
