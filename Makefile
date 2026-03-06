.PHONY: start-frontend start-backend

start-frontend:
	cd vite-app && pnpm dev

start-backend:
	cd go-server && go run .
