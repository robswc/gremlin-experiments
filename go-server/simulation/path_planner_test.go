package simulation

import (
	"math"
	"testing"
)

func TestGridPathPlannerAvoidsSquareObjects(t *testing.T) {
	planner := NewGridPathPlanner()
	start := Vector3{X: -10, Y: 5, Z: 0}
	goal := Vector3{X: 10, Y: 5, Z: 0}
	objects := []*PhysicalObject{
		NewSquareObject("square-1", Vector3{X: 0, Y: 16, Z: 0}, 8),
	}

	path, ok := planner.FindPath(start, goal, 40, 40, objects)
	if !ok {
		t.Fatal("expected a valid path around the square obstacle")
	}
	if len(path) < 3 {
		t.Fatalf("expected detour path, got %d waypoints", len(path))
	}
	assertPathClearOfObjects(t, planner, path, objects)
	if math.Abs(path[len(path)-1].X-goal.X) > 1e-6 || math.Abs(path[len(path)-1].Z-goal.Z) > 1e-6 {
		t.Fatalf("expected final waypoint to match goal, got %+v", path[len(path)-1])
	}
	assertPathHasCurveSamples(t, path)
	assertPathHasLift(t, path, start.Y)
	assertHasDetour(t, path)
}

func TestGridPathPlannerAvoidsSphereNoGoZones(t *testing.T) {
	planner := NewGridPathPlanner()
	start := Vector3{X: -12, Y: 5, Z: -12}
	goal := Vector3{X: 12, Y: 5, Z: 12}
	objects := []*PhysicalObject{
		NewSphereNoGoZone("no-go-1", Vector3{X: 0, Y: 0, Z: 0}, 6),
	}

	path, ok := planner.FindPath(start, goal, 48, 48, objects)
	if !ok {
		t.Fatal("expected a valid path around the sphere no-go zone")
	}
	assertPathClearOfObjects(t, planner, path, objects)
	assertPathHasCurveSamples(t, path)
	assertPathHasLift(t, path, start.Y)
	assertHasDetour(t, path)
}

func TestSandboxMoveAgentToRejectsBlockedDestination(t *testing.T) {
	sandbox := NewSandbox(64, 32, 64)
	agent := NewStaticAgent("agent-1", true, false, Vector3{X: -8, Y: 5, Z: 0})
	sandbox.AddAgent(agent)
	sandbox.AddObject(NewSquareObject("square-1", Vector3{X: 0, Y: 16, Z: 0}, 10))

	err := sandbox.MoveAgentTo(agent.ID, Vector3{X: 0, Y: 5, Z: 0})
	if err == nil {
		t.Fatal("expected blocked destination error")
	}
}

func TestSandboxMoveAgentToIgnoresOtherAgentsWhenPlanning(t *testing.T) {
	sandbox := NewSandbox(64, 32, 64)
	mover := NewStaticAgent("mover", true, false, Vector3{X: -12, Y: 5, Z: 0})
	other := NewStaticAgent("other", true, false, Vector3{X: 0, Y: 5, Z: 0})
	sandbox.AddAgent(mover)
	sandbox.AddAgent(other)

	if err := sandbox.MoveAgentTo(mover.ID, Vector3{X: 12, Y: 5, Z: 0}); err != nil {
		t.Fatalf("unexpected move error: %v", err)
	}
	if mover.Behavior != "move_to" {
		t.Fatalf("expected move_to behavior, got %q", mover.Behavior)
	}
	if len(mover.MovePath) == 0 {
		t.Fatal("expected move path to be populated")
	}
	if len(mover.MovePath) < 2 {
		t.Fatalf("expected at least a start and end path, got %v", mover.MovePath)
	}
	if math.Abs(mover.MovePath[len(mover.MovePath)-1].X-12) > 1e-6 || math.Abs(mover.MovePath[len(mover.MovePath)-1].Z) > 1e-6 {
		t.Fatalf("expected final waypoint to match requested destination, got %+v", mover.MovePath[len(mover.MovePath)-1])
	}
	assertPathProgressesForward(t, mover.MovePath)
	assertPathHasLift(t, mover.MovePath, mover.Position.Y)
}

func assertPathClearOfObjects(t *testing.T, planner *GridPathPlanner, path []Vector3, objects []*PhysicalObject) {
	t.Helper()
	for i := 0; i < len(path)-1; i++ {
		from := path[i]
		to := path[i+1]
		dx := to.X - from.X
		dz := to.Z - from.Z
		distance := math.Hypot(dx, dz)
		steps := int(math.Ceil(distance / 0.25))
		if steps < 1 {
			steps = 1
		}
		for step := 0; step <= steps; step++ {
			ratio := float64(step) / float64(steps)
			point := Vector3{
				X: from.X + dx*ratio,
				Y: from.Y + (to.Y-from.Y)*ratio,
				Z: from.Z + dz*ratio,
			}
			if planner.blocksPoint(point, objects) {
				t.Fatalf("path intersects an object at segment %d point %+v", i, point)
			}
		}
	}
}

func assertHasDetour(t *testing.T, path []Vector3) {
	t.Helper()
	if len(path) < 3 {
		t.Fatalf("expected at least one intermediate waypoint, got %v", path)
	}

	start := path[0]
	goal := path[len(path)-1]
	lineDX := goal.X - start.X
	lineDZ := goal.Z - start.Z
	for _, waypoint := range path[1 : len(path)-1] {
		cross := (waypoint.X-start.X)*lineDZ - (waypoint.Z-start.Z)*lineDX
		if math.Abs(cross) > 1e-6 {
			return
		}
	}

	t.Fatalf("expected path to deviate around obstacle, got %v", path)
}

func assertPathHasCurveSamples(t *testing.T, path []Vector3) {
	t.Helper()
	for _, point := range path[1 : len(path)-1] {
		if math.Abs(point.X-math.Round(point.X)) > 1e-6 || math.Abs(point.Z-math.Round(point.Z)) > 1e-6 {
			return
		}
	}

	t.Fatalf("expected smoothed path to include non-grid curve samples, got %v", path)
}

func assertPathHasLift(t *testing.T, path []Vector3, baseY float64) {
	t.Helper()
	for _, point := range path[1 : len(path)-1] {
		if point.Y > baseY+1e-6 {
			return
		}
	}

	t.Fatalf("expected path to include an elevated cruise arc, got %v", path)
}

func assertPathProgressesForward(t *testing.T, path []Vector3) {
	t.Helper()
	for i := 1; i < len(path); i++ {
		if path[i].X+1e-6 < path[i-1].X {
			t.Fatalf("expected direct path x positions to progress forward, got %v", path)
		}
	}
}
