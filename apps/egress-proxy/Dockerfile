# Egress proxy for agent sandboxes (agent-dashboard/egress-proxy).
#
# The proxy is a single TypeScript file with no dependencies. Node 24 runs it
# directly by stripping the type annotations, so there is no build step and
# nothing but Node itself in the image. See D-023 in docs/decisions.md.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

WORKDIR /app
COPY src/egress-proxy.ts ./egress-proxy.ts

USER node
EXPOSE 3128
CMD ["node", "--disable-warning=ExperimentalWarning", "egress-proxy.ts"]
