# Build stage
FROM golang:1.23-alpine AS builder
WORKDIR /app

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/ws ./cmd/ws && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/worker ./cmd/worker && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/seed ./cmd/seed

# Runtime stage
FROM alpine:3.20
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /out/api /usr/local/bin/api
COPY --from=builder /out/ws /usr/local/bin/ws
COPY --from=builder /out/worker /usr/local/bin/worker
COPY --from=builder /out/seed /usr/local/bin/seed
COPY migrations ./migrations
COPY api ./api

EXPOSE 8080 8081
CMD ["api"]
