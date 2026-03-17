package simulation

import "strings"

// Fleet groups agents and objects under a single command unit.
type Fleet struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	LeaderID  string   `json:"leaderId"`
	AgentIDs  []string `json:"agentIds,omitempty"`
	ObjectIDs []string `json:"objectIds,omitempty"`
}

func normalizeIDList(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}

	if len(out) == 0 {
		return nil
	}
	return out
}
