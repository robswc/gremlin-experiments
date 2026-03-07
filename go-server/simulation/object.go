package simulation

import "math"

// PhysicalObject is a static collidable object in the sandbox.
type PhysicalObject struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	Position Vector3 `json:"position"`
	Size     float64 `json:"size"`
	Height   float64 `json:"height"`
	Radius   float64 `json:"radius,omitempty"`
}

// NewSquareObject creates an axis-aligned cube-like obstacle with square footprint.
func NewSquareObject(id string, center Vector3, size float64) *PhysicalObject {
	return &PhysicalObject{
		ID:       id,
		Kind:     "square",
		Position: center,
		Size:     size,
		Height:   size,
	}
}

// NewSphereNoGoZone creates a spherical no-go zone.
func NewSphereNoGoZone(id string, center Vector3, radius float64) *PhysicalObject {
	return &PhysicalObject{
		ID:       id,
		Kind:     "sphere_no_go",
		Position: center,
		Radius:   radius,
	}
}

func collidesWithObject(agentPos Vector3, obj *PhysicalObject) bool {
	if obj == nil {
		return false
	}

	if obj.Kind == "sphere_no_go" {
		if obj.Radius <= 0 {
			return false
		}
		dx := agentPos.X - obj.Position.X
		dy := agentPos.Y - obj.Position.Y
		dz := agentPos.Z - obj.Position.Z
		return dx*dx+dy*dy+dz*dz <= obj.Radius*obj.Radius
	}

	if obj.Size <= 0 {
		return false
	}
	halfSize := obj.Size / 2
	halfHeight := obj.Height / 2
	return math.Abs(agentPos.X-obj.Position.X) <= halfSize &&
		math.Abs(agentPos.Z-obj.Position.Z) <= halfSize &&
		math.Abs(agentPos.Y-obj.Position.Y) <= halfHeight
}
