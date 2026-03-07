package simulation

import (
	"container/heap"
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
	ID              string          `json:"id"`
	Friendly        bool            `json:"friendly"`
	Enemy           bool            `json:"enemy"`
	Behavior        string          `json:"behavior"`
	MovementMode    string          `json:"movementMode"`
	FollowID        string          `json:"followId,omitempty"`
	Position        Vector3         `json:"position"`
	Orientation     Orientation     `json:"orientation"`
	Velocity        Vector3         `json:"velocity"`
	MoveGoal        *Vector3        `json:"moveGoal,omitempty"`
	MovePath        []Vector3       `json:"movePath,omitempty"`
	PathIndex       int             `json:"pathIndex,omitempty"`
	ActiveObjective *MoveObjective  `json:"activeObjective,omitempty"`
	Objectives      []MoveObjective `json:"objectives,omitempty"`

	orbitCenter Vector3
	orbitRadius float64
	orbitAngle  float64
	orbitSpeed  float64 // radians per second

	followDistance    float64
	followSpeed       float64
	orbitCruiseSpeed  float64
	targetSpeed       float64
	followGoal        Vector3
	desiredYaw        float64
	desiredPitch      float64
	turnRate          float64 // radians per second
	pitchRate         float64 // radians per second
	maxPitch          float64 // radians
	maxSpeed          float64 // world units per second
	accelRate         float64 // world units per second squared
	decelRate         float64 // world units per second squared
	motionTime        float64 // seconds since reset
	tailHoverAmp      float64 // world units
	tailHoverHz       float64 // cycles per second
	correctionTimer   float64
	minCorrectionWait float64
	maxCorrectionWait float64
	waypointRadius    float64 // world units
	moveSpeed         float64 // world units per second

	initialBehavior string
	initialFollowID string

	objectiveQueue  objectiveHeap
	nextObjectiveID uint64
}

// NewOrbitAgent creates an orbiting agent.
func NewOrbitAgent(id string, friendly bool, enemy bool, center Vector3) *Agent {
	return &Agent{
		ID:               id,
		Friendly:         friendly,
		Enemy:            enemy,
		Behavior:         "orbit",
		MovementMode:     "drone",
		Position:         center,
		Orientation:      Orientation{Pitch: 0, Yaw: 0, Roll: 0},
		Velocity:         Vector3{X: 0, Y: 0, Z: 0},
		orbitCenter:      center,
		orbitRadius:      4,
		orbitAngle:       0,
		orbitSpeed:       0.8,
		orbitCruiseSpeed: 3.0,
		targetSpeed:      0,
		desiredYaw:       0,
		desiredPitch:     0,
		turnRate:         2.6,
		pitchRate:        1.8,
		maxPitch:         0.8,
		maxSpeed:         7.5,
		accelRate:        6.4,
		decelRate:        7.6,
		motionTime:       0,
		waypointRadius:   0.25,
		moveSpeed:        5.5,
		initialBehavior:  "orbit",
	}
}

// NewTailAgent creates a tailing agent that follows behind a target.
func NewTailAgent(id string, friendly bool, enemy bool, center Vector3, followID string) *Agent {
	a := &Agent{
		ID:                id,
		Friendly:          friendly,
		Enemy:             enemy,
		Behavior:          "tail",
		MovementMode:      "drone",
		FollowID:          followID,
		Position:          center,
		Orientation:       Orientation{Pitch: 0, Yaw: 0, Roll: 0},
		Velocity:          Vector3{X: 0, Y: 0, Z: 0},
		orbitCenter:       center,
		followDistance:    2.5,
		followSpeed:       4.7,
		targetSpeed:       0,
		followGoal:        center,
		desiredYaw:        0,
		desiredPitch:      0,
		turnRate:          2.2,
		pitchRate:         1.5,
		maxPitch:          0.7,
		maxSpeed:          8.2,
		accelRate:         6.8,
		decelRate:         8.4,
		motionTime:        0,
		tailHoverAmp:      0.9,
		tailHoverHz:       0.45,
		minCorrectionWait: 0.08,
		maxCorrectionWait: 0.45,
		waypointRadius:    0.25,
		moveSpeed:         5.5,
		initialBehavior:   "tail",
		initialFollowID:   followID,
	}
	a.correctionTimer = a.nextCorrectionDelay()
	return a
}

// NewStaticAgent creates an agent with no behavior, which remains stationary.
func NewStaticAgent(id string, friendly bool, enemy bool, center Vector3) *Agent {
	return &Agent{
		ID:              id,
		Friendly:        friendly,
		Enemy:           enemy,
		Behavior:        "",
		MovementMode:    "drone",
		Position:        center,
		Orientation:     Orientation{Pitch: 0, Yaw: 0, Roll: 0},
		Velocity:        Vector3{},
		orbitCenter:     center,
		followGoal:      center,
		turnRate:        2.2,
		pitchRate:       1.5,
		maxPitch:        0.7,
		maxSpeed:        8.2,
		accelRate:       6.8,
		decelRate:       8.4,
		waypointRadius:  0.25,
		moveSpeed:       5.5,
		initialBehavior: "",
	}
}

// NewAgent kept for compatibility; defaults to orbit behavior.
func NewAgent(id string, friendly bool, enemy bool, center Vector3) *Agent {
	return NewOrbitAgent(id, friendly, enemy, center)
}

// StepCircle advances the agent along a circular path on the XZ floor plane.
func (a *Agent) StepCircle(deltaSeconds float64) {
	if a.MovementMode == "drone" {
		a.stepCircleDrone(deltaSeconds)
		return
	}

	a.orbitAngle += a.orbitSpeed * deltaSeconds
	a.Position.X = a.orbitCenter.X + math.Cos(a.orbitAngle)*a.orbitRadius
	a.Position.Y = a.orbitCenter.Y
	a.Position.Z = a.orbitCenter.Z + math.Sin(a.orbitAngle)*a.orbitRadius

	// Face tangent direction so renderers can display heading.
	a.Orientation.Yaw = a.orbitAngle + (math.Pi / 2)
	a.Orientation.Pitch = 0
	a.Orientation.Roll = 0
}

// StepMoveTo progresses through waypoints toward a commanded goal.
func (a *Agent) StepMoveTo(deltaSeconds float64) {
	if len(a.MovePath) == 0 {
		a.stopMotion()
		a.Behavior = ""
		a.MoveGoal = nil
		a.PathIndex = 0
		return
	}

	if a.PathIndex >= len(a.MovePath) {
		a.finishMoveTo()
		return
	}

	goal := a.MovePath[a.PathIndex]
	dx := goal.X - a.Position.X
	dy := goal.Y - a.Position.Y
	dz := goal.Z - a.Position.Z
	if math.Sqrt(dx*dx+dy*dy+dz*dz) <= a.waypointRadius {
		a.PathIndex++
		if a.PathIndex >= len(a.MovePath) {
			a.finishMoveTo()
			return
		}
		goal = a.MovePath[a.PathIndex]
	}

	a.steerToward(goal, a.moveSpeed)
	a.applyDroneMotion(deltaSeconds)
}

// HoldStationary forces immediate rest and keeps the current pose in place.
func (a *Agent) HoldStationary() {
	a.stopMotion()
}

// SetMoveCommand assigns a goal and waypoint path, switching behavior to move_to.
func (a *Agent) SetMoveCommand(goal Vector3, waypoints []Vector3) {
	cloned := make([]Vector3, len(waypoints))
	copy(cloned, waypoints)
	a.MoveGoal = &Vector3{X: goal.X, Y: goal.Y, Z: goal.Z}
	a.MovePath = cloned
	a.PathIndex = 0
	a.FollowID = ""
	a.Behavior = "move_to"
}

// EnqueueObjective appends a prioritized objective into the agent objective heap.
func (a *Agent) EnqueueObjective(kind string, target Vector3, priority int, createdTick uint64) MoveObjective {
	a.nextObjectiveID++
	obj := MoveObjective{
		ID:          a.nextObjectiveID,
		Kind:        kind,
		Target:      target,
		Priority:    priority,
		CreatedTick: createdTick,
	}
	a.enqueueObjective(obj)
	return obj
}

// EnqueueInstructionMoveObjective appends a follow_instruction move target objective.
func (a *Agent) EnqueueInstructionMoveObjective(target Vector3, createdTick uint64) MoveObjective {
	return a.EnqueueObjective(ObjectiveKindFollowInstruction, target, ObjectivePriorityFollowInstruction, createdTick)
}

// ActivateNextObjective pops highest-priority objective and activates movement.
func (a *Agent) ActivateNextObjective(path []Vector3) bool {
	obj, ok := a.dequeueObjective()
	if !ok {
		return false
	}
	a.SetMoveCommand(obj.Target, path)
	a.ActiveObjective = &obj
	return true
}

// HasQueuedObjectives returns whether there are pending objectives in memory.
func (a *Agent) HasQueuedObjectives() bool {
	return len(a.objectiveQueue) > 0
}

// NextQueuedObjective returns the next objective without removing it.
func (a *Agent) NextQueuedObjective() (MoveObjective, bool) {
	if len(a.objectiveQueue) == 0 {
		return MoveObjective{}, false
	}
	copyHeap := make(objectiveHeap, len(a.objectiveQueue))
	copy(copyHeap, a.objectiveQueue)
	heap.Init(&copyHeap)
	next := heap.Pop(&copyHeap).(MoveObjective)
	return next, true
}

// SetBehavior switches runtime behavior modes.
func (a *Agent) SetBehavior(behavior string) {
	switch behavior {
	case "", "stationary":
		a.Behavior = ""
		a.FollowID = ""
		a.MoveGoal = nil
		a.MovePath = nil
		a.PathIndex = 0
		a.objectiveQueue = nil
		a.ActiveObjective = nil
		a.Objectives = nil
		a.stopMotion()
	case "orbit":
		a.Behavior = "orbit"
		a.FollowID = ""
		a.MoveGoal = nil
		a.MovePath = nil
		a.PathIndex = 0
		a.objectiveQueue = nil
		a.ActiveObjective = nil
		a.Objectives = nil
		a.stopMotion()
		// Orbit around current position when switching in, to avoid jumps.
		a.orbitCenter = a.Position
		a.orbitAngle = 0
	}
}

func (a *Agent) finishMoveTo() {
	if a.MoveGoal != nil {
		a.Position = *a.MoveGoal
	}
	a.stopMotion()
	a.Behavior = ""
	a.MoveGoal = nil
	a.MovePath = nil
	a.PathIndex = 0
	a.ActiveObjective = nil
}

func (a *Agent) stopMotion() {
	a.targetSpeed = 0
	a.desiredYaw = a.Orientation.Yaw
	a.desiredPitch = 0
	a.Velocity = Vector3{}
}

func (a *Agent) stepCircleDrone(deltaSeconds float64) {
	a.orbitAngle += a.orbitSpeed * deltaSeconds

	goal := Vector3{
		X: a.orbitCenter.X + math.Cos(a.orbitAngle)*a.orbitRadius,
		Y: a.orbitCenter.Y,
		Z: a.orbitCenter.Z + math.Sin(a.orbitAngle)*a.orbitRadius,
	}

	a.steerToward(goal, a.orbitCruiseSpeed)
	a.applyDroneMotion(deltaSeconds)
}

// StepTail follows behind the target and only refreshes follow-goal after random delays.
func (a *Agent) StepTail(target *Agent, deltaSeconds float64) {
	if target == nil {
		a.targetSpeed = 0
		a.applyDroneMotion(deltaSeconds)
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

	if a.MovementMode == "drone" {
		if a.Friendly {
			hoverOffset := math.Sin(a.motionTime*2*math.Pi*a.tailHoverHz) * a.tailHoverAmp
			a.followGoal.Y = target.Position.Y + hoverOffset
		}
		a.steerToward(a.followGoal, a.followSpeed)
		a.applyDroneMotion(deltaSeconds)
		return
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

func (a *Agent) steerToward(goal Vector3, preferredSpeed float64) {
	dx := goal.X - a.Position.X
	dy := goal.Y - a.Position.Y
	dz := goal.Z - a.Position.Z
	distance := math.Sqrt(dx*dx + dy*dy + dz*dz)

	horizontalDistance := math.Hypot(dx, dz)
	a.desiredYaw = math.Atan2(dz, dx)
	a.desiredPitch = clamp(math.Atan2(dy, horizontalDistance), -a.maxPitch, a.maxPitch)

	slowRadius := 2.0
	speedScale := 1.0
	if distance < slowRadius {
		speedScale = distance / slowRadius
	}
	if speedScale < 0 {
		speedScale = 0
	}
	a.targetSpeed = preferredSpeed * speedScale
	if distance < 0.05 {
		a.targetSpeed = 0
	}
}

func (a *Agent) applyDroneMotion(deltaSeconds float64) {
	if deltaSeconds <= 0 {
		return
	}
	a.motionTime += deltaSeconds

	a.Orientation.Yaw = rotateToward(a.Orientation.Yaw, a.desiredYaw, a.turnRate*deltaSeconds)
	a.Orientation.Pitch = rotateToward(a.Orientation.Pitch, a.desiredPitch, a.pitchRate*deltaSeconds)
	a.Orientation.Pitch = clamp(a.Orientation.Pitch, -a.maxPitch, a.maxPitch)
	a.Orientation.Roll = 0

	currentSpeed := magnitude(a.Velocity)
	if a.targetSpeed > currentSpeed {
		currentSpeed += a.accelRate * deltaSeconds
		if currentSpeed > a.targetSpeed {
			currentSpeed = a.targetSpeed
		}
	} else {
		currentSpeed -= a.decelRate * deltaSeconds
		if currentSpeed < a.targetSpeed {
			currentSpeed = a.targetSpeed
		}
	}
	currentSpeed = clamp(currentSpeed, 0, a.maxSpeed)

	cosPitch := math.Cos(a.Orientation.Pitch)
	forward := Vector3{
		X: cosPitch * math.Cos(a.Orientation.Yaw),
		Y: math.Sin(a.Orientation.Pitch),
		Z: cosPitch * math.Sin(a.Orientation.Yaw),
	}

	a.Velocity = Vector3{
		X: forward.X * currentSpeed,
		Y: forward.Y * currentSpeed,
		Z: forward.Z * currentSpeed,
	}

	a.Position.X += a.Velocity.X * deltaSeconds
	a.Position.Y += a.Velocity.Y * deltaSeconds
	a.Position.Z += a.Velocity.Z * deltaSeconds
}

func rotateToward(current, target, maxStep float64) float64 {
	delta := normalizeAngle(target - current)
	if delta > maxStep {
		delta = maxStep
	} else if delta < -maxStep {
		delta = -maxStep
	}
	return normalizeAngle(current + delta)
}

func clamp(v, minV, maxV float64) float64 {
	if v < minV {
		return minV
	}
	if v > maxV {
		return maxV
	}
	return v
}

func magnitude(v Vector3) float64 {
	return math.Sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z)
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
	a.Velocity = Vector3{X: 0, Y: 0, Z: 0}
	a.orbitAngle = 0
	a.Behavior = a.initialBehavior
	a.FollowID = a.initialFollowID
	a.targetSpeed = 0
	a.motionTime = 0
	a.followGoal = a.orbitCenter
	a.desiredYaw = 0
	a.desiredPitch = 0
	a.correctionTimer = a.nextCorrectionDelay()
	a.MoveGoal = nil
	a.MovePath = nil
	a.PathIndex = 0
	a.objectiveQueue = nil
	a.ActiveObjective = nil
	a.Objectives = nil
}
