package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"gremlin-experiments/go-server/simulation"
)

func main() {
	// Create a larger sandbox and seed static obstacles.
	sandbox := simulation.NewSandbox(128, 64, 128)
	if err := sandbox.AddSpawnPoint(simulation.NewSpawnPoint("sp1", simulation.Vector3{X: 64, Y: 5, Z: 0})); err != nil {
		log.Fatalf("failed to add spawn point sp1: %v", err)
	}
	if err := sandbox.SpawnOrbitAgentFromPoint("sp1", "friendly-1", true, false); err != nil {
		log.Fatalf("failed to spawn friendly-1 from sp1: %v", err)
	}
	sandbox.AddObject(simulation.NewSquareObject("square-1", simulation.Vector3{X: 32, Y: 16, Z: 32}, 32))
	sandbox.AddObject(simulation.NewSphereNoGoZone("no-go-aa-1", simulation.Vector3{X: -32, Y: 0, Z: -32}, 18))
	sandbox.AddObject(simulation.NewSphereNoGoZone("no-go-aa-2", simulation.Vector3{X: -64, Y: 0, Z: 32}, 18))

	// Start simulation in background
	go sandbox.Run()
	defer sandbox.Stop()

	// SSE endpoint — streams sandbox state each tick
	http.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers for local dev
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		ch := sandbox.Subscribe()
		defer sandbox.Unsubscribe(ch)

		for {
			select {
			case state := <-ch:
				data, err := json.Marshal(state)
				if err != nil {
					log.Printf("json marshal error: %v", err)
					return
				}
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()

			case <-r.Context().Done():
				return
			}
		}
	})

	// Health check
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// Reset simulation state to origin.
	http.HandleFunc("/reset", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		sandbox.Reset()
		w.WriteHeader(http.StatusNoContent)
	})

	// Command an agent to navigate to coordinates.
	http.HandleFunc("/move-to", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		type moveToRequest struct {
			ID       string              `json:"id"`
			Position *simulation.Vector3 `json:"position"`
			Coords   *simulation.Vector3 `json:"coords"`
		}

		var req moveToRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		req.ID = strings.TrimSpace(req.ID)
		if req.ID == "" {
			http.Error(w, "id is required", http.StatusBadRequest)
			return
		}

		var destination simulation.Vector3
		switch {
		case req.Coords != nil:
			destination = *req.Coords
		case req.Position != nil:
			destination = *req.Position
		default:
			http.Error(w, "position or coords is required", http.StatusBadRequest)
			return
		}

		if err := sandbox.MoveAgentTo(req.ID, destination); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":          true,
			"id":          req.ID,
			"destination": destination,
		})
	})

	// Switch an agent behavior between stationary and orbit.
	http.HandleFunc("/agent-behavior", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		type behaviorRequest struct {
			ID       string `json:"id"`
			Behavior string `json:"behavior"`
		}

		var req behaviorRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		req.ID = strings.TrimSpace(req.ID)
		req.Behavior = strings.TrimSpace(req.Behavior)
		if req.ID == "" {
			http.Error(w, "id is required", http.StatusBadRequest)
			return
		}
		if req.Behavior == "" {
			http.Error(w, "behavior is required", http.StatusBadRequest)
			return
		}

		if err := sandbox.SetAgentBehavior(req.ID, req.Behavior); err != nil {
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "not found") {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":       true,
			"id":       req.ID,
			"behavior": strings.ToLower(req.Behavior),
		})
	})

	addr := ":8080"
	log.Printf("Go server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
