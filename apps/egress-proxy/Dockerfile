# Egress proxy for agent sandboxes (agent-dashboard/egress-proxy).
#
# The proxy is a single TypeScript file with no dependencies. Node 24 runs it
# directly by stripping the type annotations, so there is no build step and
# nothing but Node itself in the image. See D-023 in docs/decisions.md.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80

WORKDIR /app
COPY src/egress-proxy.ts ./egress-proxy.ts

USER node
EXPOSE 3128
CMD ["node", "--disable-warning=ExperimentalWarning", "egress-proxy.ts"]
