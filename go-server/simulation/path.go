package simulation

// Path is a named world-space route that can be assigned to entities.
type Path struct {
	ID     string    `json:"id"`
	Name   string    `json:"name"`
	Points []Vector3 `json:"points"`
}

// NewPath builds a named route from world-space points.
func NewPath(id, name string, points []Vector3) *Path {
	clonedPoints := make([]Vector3, len(points))
	copy(clonedPoints, points)

	return &Path{
		ID:     id,
		Name:   name,
		Points: clonedPoints,
	}
}
