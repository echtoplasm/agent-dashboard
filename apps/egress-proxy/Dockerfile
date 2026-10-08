# Egress proxy for agent sandboxes (agent-dashboard/egress-proxy).
#
# The proxy is a single TypeScript file with no dependencies. Node 24 runs it
# directly by stripping the type annotations, so there is no build step and
# nothing but Node itself in the image. See D-023 in docs/decisions.md.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

WORKDIR /app
COPY src/egress-proxy.ts ./egress-proxy.ts

USER node
EXPOSE 3128
CMD ["node", "--disable-warning=ExperimentalWarning", "egress-proxy.ts"]
