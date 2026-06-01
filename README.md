# comission-mgmt

## Local development

Requires: `docker`, `k3d`, `kubectl`, `bun`. Optionally `cloudflared` for a public tunnel.

```bash
bun run local-demo            # start k3d cluster, migrate, build, deploy, open tunnel
bun run local-demo --no-tunnel  # same without cloudflared (CI-safe)
bun run local-demo --status   # print cluster status and exit
```

The script creates a k3d cluster named `commission-demo`, applies the dev Postgres manifests
in `k8s/dev/`, runs migrations, builds the app image, deploys it, and starts a cloudflared
tunnel pointing at `http://localhost:58080`. Press Enter to redeploy after source changes;
`q` to quit and tear down the cluster.

## Docs

- [Product Requirements Document](docs/prd.md)
- [Plan](docs/plan.md)
- [Industry Background](docs/product/industry-background.md)
- [Product Hypotheses](docs/product/product-hypotheses.md)
