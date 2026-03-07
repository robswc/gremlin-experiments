package simulation

import "strings"

// SpawnPoint names a world position where agents can be spawned.
type SpawnPoint struct {
	ID       string  `json:"id"`
	Position Vector3 `json:"position"`
}

// NewSpawnPoint creates a spawn point with normalized ID.
func NewSpawnPoint(id string, position Vector3) *SpawnPoint {
	return &SpawnPoint{
		ID:       strings.TrimSpace(id),
		Position: position,
	}
}
