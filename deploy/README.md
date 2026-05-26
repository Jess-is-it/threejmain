# Production Deployment

Production is deployed from `origin/master` on the same host as the shared development checkout, but it uses a separate checkout and Docker Compose project:

- Source/development checkout: `/home/threejmain`
- Production checkout: `/home/threejmain-production`
- Production Compose project: `threejmain-production`
- Production branch: `master`
- Production web URL: `http://192.168.50.70:8180/`
- Production API URL: `http://192.168.50.70:8100/`

The production Compose project creates its own Docker volumes, so production data is not shared with the old staging/test Compose project. The deploy script stops the old `threejmain` Compose project before starting production because both stacks would otherwise compete for ports `8180` and `8100`.

Install or refresh the master watcher:

```bash
scripts/install_production_autodeploy.sh
```

Run one deploy/check manually:

```bash
scripts/production_auto_deploy.sh --once
```

Deploy immediately from current `origin/master`:

```bash
scripts/production_deploy.sh
```

Useful service checks:

```bash
systemctl status threejmain-production-auto-deploy.service
journalctl -u threejmain-production-auto-deploy.service -n 100 --no-pager
docker compose --project-name threejmain-production -f /home/threejmain-production/docker-compose.yml ps
```
