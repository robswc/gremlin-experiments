package simulation

import "container/heap"

const (
	ObjectiveKindSelfPreservation  = "self_preservation"
	ObjectiveKindFollowInstruction = "follow_instruction"

	ObjectivePrioritySelfPreservation  = 0
	ObjectivePriorityFollowInstruction = 10
)

// MoveObjective is a queued navigation intent held in agent memory.
type MoveObjective struct {
	ID          uint64  `json:"id"`
	Kind        string  `json:"kind"`
	Target      Vector3 `json:"target"`
	Priority    int     `json:"priority"`
	CreatedTick uint64  `json:"createdTick"`
}

type objectiveHeap []MoveObjective

func (h objectiveHeap) Len() int { return len(h) }

func (h objectiveHeap) Less(i, j int) bool {
	if h[i].Priority != h[j].Priority {
		// Lower numeric priority is dequeued first.
		return h[i].Priority < h[j].Priority
	}
	if h[i].CreatedTick != h[j].CreatedTick {
		return h[i].CreatedTick < h[j].CreatedTick
	}
	return h[i].ID < h[j].ID
}

func (h objectiveHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
}

func (h *objectiveHeap) Push(x any) {
	*h = append(*h, x.(MoveObjective))
}

func (h *objectiveHeap) Pop() any {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[:n-1]
	return item
}

func (a *Agent) enqueueObjective(obj MoveObjective) {
	heap.Push(&a.objectiveQueue, obj)
	a.syncObjectiveSnapshot()
}

func (a *Agent) dequeueObjective() (MoveObjective, bool) {
	if len(a.objectiveQueue) == 0 {
		return MoveObjective{}, false
	}
	obj := heap.Pop(&a.objectiveQueue).(MoveObjective)
	a.syncObjectiveSnapshot()
	return obj, true
}

func (a *Agent) syncObjectiveSnapshot() {
	if len(a.objectiveQueue) == 0 {
		a.Objectives = nil
		return
	}

	copyHeap := make(objectiveHeap, len(a.objectiveQueue))
	copy(copyHeap, a.objectiveQueue)
	heap.Init(&copyHeap)

	snapshot := make([]MoveObjective, 0, len(copyHeap))
	for len(copyHeap) > 0 {
		next := heap.Pop(&copyHeap).(MoveObjective)
		snapshot = append(snapshot, next)
	}
	a.Objectives = snapshot
}

func (a *Agent) hasQueuedObjectiveKind(kind string) bool {
	for _, obj := range a.objectiveQueue {
		if obj.Kind == kind {
			return true
		}
	}
	return false
}

func (a *Agent) nextQueuedObjectivePriority() (int, bool) {
	next, ok := a.NextQueuedObjective()
	if !ok {
		return 0, false
	}
	return next.Priority, true
}
