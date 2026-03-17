package simulation

import "math"

// GridPathPlanner uses 2D A* (XZ plane) over sandbox bounds.
type GridPathPlanner struct {
	CellSize          float64
	Clearance         float64
	TurnDistance      float64
	ArcSampleDistance float64
	ArcLiftFactor     float64
	MaxArcLift        float64
	MinArcDistance    float64
	CurveSubdivisions int
}

// NewGridPathPlanner returns a planner tuned for this sandbox scale.
func NewGridPathPlanner() *GridPathPlanner {
	return &GridPathPlanner{
		CellSize:          1.0,
		Clearance:         0.75,
		TurnDistance:      1.75,
		ArcSampleDistance: 2.25,
		ArcLiftFactor:     0.08,
		MaxArcLift:        3.5,
		MinArcDistance:    8.0,
		CurveSubdivisions: 5,
	}
}

type gridNode struct {
	x int
	z int
}

// FindPath computes a path from start to goal while avoiding physical objects.
func (p *GridPathPlanner) FindPath(start, goal Vector3, width, depth float64, objects []*PhysicalObject) ([]Vector3, bool) {
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
		return []Vector3{goal}, true
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

	blockedSet := make(map[gridNode]bool, gxCount*gzCount)
	for x := 0; x < gxCount; x++ {
		for z := 0; z < gzCount; z++ {
			node := gridNode{x: x, z: z}
			point := toWorld(node, goal.Y)
			if p.blocksPoint(point, objects) {
				blockedSet[node] = true
			}
		}
	}

	delete(blockedSet, startNode)
	if blockedSet[goalNode] {
		return nil, false
	}

	pathNodes := aStarGrid(startNode, goalNode, gxCount, gzCount, blockedSet)
	if len(pathNodes) == 0 {
		return nil, false
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
	path := compressPath(out)
	path = p.smoothPath(path, objects)
	return p.applyFlightArc(path), true
}

func (p *GridPathPlanner) smoothPath(points []Vector3, objects []*PhysicalObject) []Vector3 {
	if len(points) <= 2 {
		return points
	}

	turnDistance := p.TurnDistance
	if turnDistance <= 0 {
		turnDistance = p.CellSize * 1.5
	}
	curveSubdivisions := p.CurveSubdivisions
	if curveSubdivisions < 2 {
		curveSubdivisions = 2
	}

	smoothed := []Vector3{points[0]}
	for i := 1; i < len(points)-1; i++ {
		prev := points[i-1]
		curr := points[i]
		next := points[i+1]

		inLength := distanceXZ(prev, curr)
		outLength := distanceXZ(curr, next)
		if inLength < 1e-6 || outLength < 1e-6 {
			smoothed = appendIfDistinct(smoothed, curr)
			continue
		}

		trim := minFloat(turnDistance, inLength*0.35, outLength*0.35)
		if trim < 0.1 {
			smoothed = appendIfDistinct(smoothed, curr)
			continue
		}

		entry := moveAlongLine(curr, prev, trim)
		exit := moveAlongLine(curr, next, trim)
		smoothed = appendIfDistinct(smoothed, entry)
		for step := 1; step < curveSubdivisions; step++ {
			t := float64(step) / float64(curveSubdivisions)
			smoothed = appendIfDistinct(smoothed, quadraticBezier(entry, curr, exit, t))
		}
		smoothed = appendIfDistinct(smoothed, exit)
	}
	smoothed = appendIfDistinct(smoothed, points[len(points)-1])

	if !p.pathClear(smoothed, objects) {
		return points
	}

	return smoothed
}

func (p *GridPathPlanner) applyFlightArc(points []Vector3) []Vector3 {
	if len(points) <= 1 {
		return points
	}

	totalDistance := polylineDistanceXZ(points)
	if totalDistance < p.MinArcDistance {
		return points
	}

	step := p.ArcSampleDistance
	if step <= 0 {
		step = 2.0
	}
	lift := totalDistance * p.ArcLiftFactor
	if lift > p.MaxArcLift {
		lift = p.MaxArcLift
	}
	if lift <= 0 {
		return points
	}

	sampled := samplePath(points, step)
	if len(sampled) <= 2 {
		return sampled
	}

	totalSampleDistance := polylineDistanceXZ(sampled)
	if totalSampleDistance < 1e-6 {
		return sampled
	}

	withArc := make([]Vector3, len(sampled))
	traveled := 0.0
	for i, point := range sampled {
		if i > 0 {
			traveled += distanceXZ(sampled[i-1], point)
		}
		progress := traveled / totalSampleDistance
		arcLift := math.Sin(progress*math.Pi) * lift
		withArc[i] = Vector3{X: point.X, Y: point.Y + arcLift, Z: point.Z}
	}
	withArc[0] = points[0]
	withArc[len(withArc)-1] = points[len(points)-1]
	return withArc
}

func (p *GridPathPlanner) blocksPoint(point Vector3, objects []*PhysicalObject) bool {
	clearance := p.Clearance
	if clearance < 0 {
		clearance = 0
	}

	for _, obj := range objects {
		if obj == nil {
			continue
		}

		switch obj.Kind {
		case "sphere_no_go":
			radius := obj.Radius + clearance
			if radius <= 0 {
				continue
			}
			dx := point.X - obj.Position.X
			dz := point.Z - obj.Position.Z
			if dx*dx+dz*dz <= radius*radius {
				return true
			}
		default:
			halfSize := (obj.Size / 2) + clearance
			if halfSize <= 0 {
				continue
			}
			if math.Abs(point.X-obj.Position.X) <= halfSize && math.Abs(point.Z-obj.Position.Z) <= halfSize {
				return true
			}
		}
	}

	return false
}

func (p *GridPathPlanner) pathClear(points []Vector3, objects []*PhysicalObject) bool {
	if len(points) == 0 {
		return true
	}

	stepSize := p.CellSize / 4
	if stepSize <= 0 {
		stepSize = 0.25
	}
	if stepSize > 0.25 {
		stepSize = 0.25
	}

	for i := 0; i < len(points)-1; i++ {
		from := points[i]
		to := points[i+1]
		distance := distanceXZ(from, to)
		steps := int(math.Ceil(distance / stepSize))
		if steps < 1 {
			steps = 1
		}
		for step := 0; step <= steps; step++ {
			t := float64(step) / float64(steps)
			point := Vector3{
				X: from.X + (to.X-from.X)*t,
				Y: from.Y + (to.Y-from.Y)*t,
				Z: from.Z + (to.Z-from.Z)*t,
			}
			if p.blocksPoint(point, objects) {
				return false
			}
		}
	}

	return true
}

func appendIfDistinct(points []Vector3, point Vector3) []Vector3 {
	if len(points) == 0 {
		return append(points, point)
	}
	last := points[len(points)-1]
	if math.Abs(last.X-point.X) < 1e-6 && math.Abs(last.Y-point.Y) < 1e-6 && math.Abs(last.Z-point.Z) < 1e-6 {
		return points
	}
	return append(points, point)
}

func quadraticBezier(a, b, c Vector3, t float64) Vector3 {
	oneMinusT := 1 - t
	return Vector3{
		X: oneMinusT*oneMinusT*a.X + 2*oneMinusT*t*b.X + t*t*c.X,
		Y: oneMinusT*oneMinusT*a.Y + 2*oneMinusT*t*b.Y + t*t*c.Y,
		Z: oneMinusT*oneMinusT*a.Z + 2*oneMinusT*t*b.Z + t*t*c.Z,
	}
}

func moveAlongLine(from, to Vector3, distance float64) Vector3 {
	length := distanceXZ(from, to)
	if length < 1e-6 {
		return from
	}
	ratio := distance / length
	if ratio > 1 {
		ratio = 1
	}
	return Vector3{
		X: from.X + (to.X-from.X)*ratio,
		Y: from.Y + (to.Y-from.Y)*ratio,
		Z: from.Z + (to.Z-from.Z)*ratio,
	}
}

func distanceXZ(a, b Vector3) float64 {
	return math.Hypot(b.X-a.X, b.Z-a.Z)
}

func polylineDistanceXZ(points []Vector3) float64 {
	if len(points) < 2 {
		return 0
	}

	total := 0.0
	for i := 1; i < len(points); i++ {
		total += distanceXZ(points[i-1], points[i])
	}
	return total
}

func samplePath(points []Vector3, step float64) []Vector3 {
	if len(points) <= 2 || step <= 0 {
		cloned := make([]Vector3, len(points))
		copy(cloned, points)
		return cloned
	}

	totalDistance := polylineDistanceXZ(points)
	if totalDistance < 1e-6 {
		cloned := make([]Vector3, len(points))
		copy(cloned, points)
		return cloned
	}

	sampled := []Vector3{points[0]}
	for targetDistance := step; targetDistance < totalDistance; targetDistance += step {
		sampled = appendIfDistinct(sampled, pointAlongPath(points, targetDistance))
	}
	sampled = appendIfDistinct(sampled, points[len(points)-1])
	return sampled
}

func pointAlongPath(points []Vector3, targetDistance float64) Vector3 {
	if len(points) == 0 {
		return Vector3{}
	}
	if len(points) == 1 || targetDistance <= 0 {
		return points[0]
	}

	covered := 0.0
	for i := 1; i < len(points); i++ {
		segmentLength := distanceXZ(points[i-1], points[i])
		if covered+segmentLength >= targetDistance {
			localDistance := targetDistance - covered
			ratio := 0.0
			if segmentLength > 1e-6 {
				ratio = localDistance / segmentLength
			}
			return Vector3{
				X: points[i-1].X + (points[i].X-points[i-1].X)*ratio,
				Y: points[i-1].Y + (points[i].Y-points[i-1].Y)*ratio,
				Z: points[i-1].Z + (points[i].Z-points[i-1].Z)*ratio,
			}
		}
		covered += segmentLength
	}

	return points[len(points)-1]
}

func minFloat(values ...float64) float64 {
	best := values[0]
	for _, value := range values[1:] {
		if value < best {
			best = value
		}
	}
	return best
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
			if step.x != 0 && step.z != 0 {
				horizontal := gridNode{x: current.x + step.x, z: current.z}
				vertical := gridNode{x: current.x, z: current.z + step.z}
				if blocked[horizontal] || blocked[vertical] {
					continue
				}
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
