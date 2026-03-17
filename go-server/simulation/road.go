package simulation

// Road is a named path on the ground plane rendered with a visible width.
type Road struct {
	ID     string    `json:"id"`
	Name   string    `json:"name"`
	Width  float64   `json:"width"`
	Points []Vector3 `json:"points"`
}

// NewRoad builds a road path from world-space points.
func NewRoad(id, name string, width float64, points []Vector3) *Road {
	clonedPoints := make([]Vector3, len(points))
	copy(clonedPoints, points)

	return &Road{
		ID:     id,
		Name:   name,
		Width:  width,
		Points: clonedPoints,
	}
}
