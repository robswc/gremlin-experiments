package simulation

import (
	"math"
	"testing"
)

func TestAgentAssignedPathOnceStopsAtEnd(t *testing.T) {
	agent := NewStaticAgent("agent-1", true, false, Vector3{X: 0, Y: 10, Z: 0})
	waypoints := []Vector3{
		{X: 0, Y: 10, Z: 0},
		{X: 15, Y: 10, Z: 0},
	}

	agent.AssignPath("path-air", waypoints, false)
	for i := 0; i < 400 && agent.Behavior == "path"; i++ {
		agent.StepAssignedPath(0.05)
	}

	if agent.Behavior != "" {
		t.Fatalf("expected one-shot path to finish and clear behavior, got %q", agent.Behavior)
	}
	if math.Abs(agent.Position.X-15) > 0.5 || math.Abs(agent.Position.Y-10) > 0.5 {
		t.Fatalf("expected final position near last waypoint, got %+v", agent.Position)
	}
}

func TestAgentAssignedPathRepeatKeepsRunning(t *testing.T) {
	agent := NewStaticAgent("agent-1", true, false, Vector3{X: 0, Y: 10, Z: 0})
	waypoints := []Vector3{
		{X: 0, Y: 10, Z: 0},
		{X: 12, Y: 10, Z: 0},
	}

	agent.AssignPath("path-air", waypoints, true)
	for i := 0; i < 600; i++ {
		agent.StepAssignedPath(0.05)
	}

	if agent.Behavior != "path" {
		t.Fatalf("expected repeat path to keep path behavior, got %q", agent.Behavior)
	}
	if agent.AssignedPathMode != "repeat" {
		t.Fatalf("expected repeat mode, got %q", agent.AssignedPathMode)
	}
}

func TestSandboxAssignPathToAgent(t *testing.T) {
	sandbox := NewSandbox(64, 32, 64)
	agent := NewStaticAgent("agent-1", true, false, Vector3{X: 0, Y: 10, Z: 0})
	sandbox.AddAgent(agent)
	sandbox.AddPath(NewPath("path-air", "Air", []Vector3{{X: 0, Y: 10, Z: 0}, {X: 5, Y: 10, Z: 0}}))

	if err := sandbox.AssignPathToAgent("agent-1", "path-air", "once"); err != nil {
		t.Fatalf("unexpected assignment error: %v", err)
	}
	if agent.Behavior != "path" {
		t.Fatalf("expected agent behavior path, got %q", agent.Behavior)
	}
	if agent.AssignedPathID != "path-air" {
		t.Fatalf("expected assigned path id, got %q", agent.AssignedPathID)
	}

	if err := sandbox.AssignPathToAgent("agent-1", "path-air", "bad-mode"); err == nil {
		t.Fatal("expected invalid mode error")
	}
}
