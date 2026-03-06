package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"gremlin-experiments/go-server/simulation"
)

func main() {
	// Create a 20x20x20 sandbox with two agents 10 units apart.
	sandbox := simulation.NewSandbox(20, 20, 20)
	sandbox.AddAgent(simulation.NewTailAgent("friendly-1", true, false, simulation.Vector3{X: -5, Y: 0, Z: 0}, "enemy-1"))
	sandbox.AddAgent(simulation.NewOrbitAgent("enemy-1", false, true, simulation.Vector3{X: 5, Y: 0, Z: 0}))

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

	addr := ":8080"
	log.Printf("Go server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
