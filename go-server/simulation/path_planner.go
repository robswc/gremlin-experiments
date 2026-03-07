package simulation

import "math"

// GridPathPlanner uses 2D A* (XZ plane) over sandbox bounds.
type GridPathPlanner struct {
	CellSize       float64
	ObstacleRadius float64
}

// NewGridPathPlanner returns a planner tuned for this sandbox scale.
func NewGridPathPlanner() *GridPathPlanner {
	return &GridPathPlanner{
		CellSize:       1.0,
		ObstacleRadius: 0.8,
	}
}

type gridNode struct {
	x int
	z int
}

// FindPath computes a path from start to goal while avoiding occupied cells.
func (p *GridPathPlanner) FindPath(start, goal Vector3, width, depth float64, blocked []Vector3) []Vector3 {
	cell := p.CellSize
	if cell <= 0 {
		cell = 1.0
	}

	halfW := width / 2
	halfD := depth / 2
	minX := -halfW
	minZ := -halfD

	gxCount := int(math.Round(width/cell)) + 1
	gzCount := int(math.Round(depth/cell)) + 1
	if gxCount < 2 || gzCount < 2 {
		return []Vector3{goal}
	}

	toCell := func(v Vector3) gridNode {
		x := int(math.Round((v.X - minX) / cell))
		z := int(math.Round((v.Z - minZ) / cell))
		if x < 0 {
			x = 0
		}
		if x >= gxCount {
			x = gxCount - 1
		}
		if z < 0 {
			z = 0
		}
		if z >= gzCount {
			z = gzCount - 1
		}
		return gridNode{x: x, z: z}
	}

	toWorld := func(n gridNode, y float64) Vector3 {
		return Vector3{
			X: minX + float64(n.x)*cell,
			Y: y,
			Z: minZ + float64(n.z)*cell,
		}
	}

	startNode := toCell(start)
	goalNode := toCell(goal)

	blockedSet := make(map[gridNode]bool)
	radiusCells := int(math.Ceil(p.ObstacleRadius / cell))
	for _, b := range blocked {
		center := toCell(b)
		for dx := -radiusCells; dx <= radiusCells; dx++ {
			for dz := -radiusCells; dz <= radiusCells; dz++ {
				n := gridNode{x: center.x + dx, z: center.z + dz}
				if n.x < 0 || n.x >= gxCount || n.z < 0 || n.z >= gzCount {
					continue
				}
				if dx*dx+dz*dz <= radiusCells*radiusCells {
					blockedSet[n] = true
				}
			}
		}
	}

	delete(blockedSet, startNode)
	delete(blockedSet, goalNode)

	pathNodes := aStarGrid(startNode, goalNode, gxCount, gzCount, blockedSet)
	if len(pathNodes) == 0 {
		return []Vector3{goal}
	}

	out := make([]Vector3, 0, len(pathNodes)+1)
	for i, n := range pathNodes {
		y := goal.Y
		if i == 0 {
			y = start.Y
		}
		out = append(out, toWorld(n, y))
	}
	out[len(out)-1] = goal
	return compressPath(out)
}

func aStarGrid(start, goal gridNode, maxX, maxZ int, blocked map[gridNode]bool) []gridNode {
	openSet := map[gridNode]bool{start: true}
	cameFrom := make(map[gridNode]gridNode)
	gScore := map[gridNode]float64{start: 0}
	fScore := map[gridNode]float64{start: heuristic(start, goal)}

	neighbors := []gridNode{
		{x: 1, z: 0}, {x: -1, z: 0}, {x: 0, z: 1}, {x: 0, z: -1},
		{x: 1, z: 1}, {x: 1, z: -1}, {x: -1, z: 1}, {x: -1, z: -1},
	}

	for len(openSet) > 0 {
		current, ok := lowestF(openSet, fScore)
		if !ok {
			break
		}
		if current == goal {
			return reconstructPath(cameFrom, current)
		}

		delete(openSet, current)

		for _, step := range neighbors {
			next := gridNode{x: current.x + step.x, z: current.z + step.z}
			if next.x < 0 || next.x >= maxX || next.z < 0 || next.z >= maxZ {
				continue
			}
			if blocked[next] {
				continue
			}

			cost := 1.0
			if step.x != 0 && step.z != 0 {
				cost = math.Sqrt2
			}
			tentativeG := gScore[current] + cost

			oldG, exists := gScore[next]
			if !exists || tentativeG < oldG {
				cameFrom[next] = current
				gScore[next] = tentativeG
				fScore[next] = tentativeG + heuristic(next, goal)
				openSet[next] = true
			}
		}
	}

	return nil
}

func lowestF(openSet map[gridNode]bool, fScore map[gridNode]float64) (gridNode, bool) {
	best := gridNode{}
	bestSet := false
	bestScore := 0.0
	for n := range openSet {
		score, ok := fScore[n]
		if !ok {
			score = math.Inf(1)
		}
		if !bestSet || score < bestScore {
			best = n
			bestScore = score
			bestSet = true
		}
	}
	return best, bestSet
}

func heuristic(a, b gridNode) float64 {
	dx := float64(a.x - b.x)
	dz := float64(a.z - b.z)
	return math.Sqrt(dx*dx + dz*dz)
}

func reconstructPath(cameFrom map[gridNode]gridNode, current gridNode) []gridNode {
	path := []gridNode{current}
	for {
		prev, ok := cameFrom[current]
		if !ok {
			break
		}
		current = prev
		path = append(path, current)
	}

	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	return path
}

func compressPath(points []Vector3) []Vector3 {
	if len(points) <= 2 {
		return points
	}

	out := []Vector3{points[0]}
	for i := 1; i < len(points)-1; i++ {
		prev := out[len(out)-1]
		curr := points[i]
		next := points[i+1]
		if isCollinearXZ(prev, curr, next) {
			continue
		}
		out = append(out, curr)
	}
	out = append(out, points[len(points)-1])
	return out
}

func isCollinearXZ(a, b, c Vector3) bool {
	abx := b.X - a.X
	abz := b.Z - a.Z
	bcx := c.X - b.X
	bcz := c.Z - b.Z
	cross := abx*bcz - abz*bcx
	return math.Abs(cross) < 1e-6
}
