# Production Deployment

## Fresh Server One-Line Install / Update

On a fresh Ubuntu production server, run:

```bash
curl -fsSL https://raw.githubusercontent.com/Jess-is-it/threejmain/master/scripts/production_bootstrap.sh | sudo bash
```

The same command is used for later production updates. On first run it prompts for the production owner username, email, contact number, and password; installs base packages and Docker Engine; clones `origin/master` into `/home/threejmain`; creates `/home/threejmain/.env`; deploys `/home/threejmain-production`; starts Docker Compose project `threejmain-production`; and installs `threejmain-production-deploy-control.service` for manual UI-controlled deploys. On later runs it preserves `.env` and Docker volumes, fast-forwards the source checkout, rebuilds, and redeploys from the latest `origin/master`.

Useful overrides:

```bash
curl -fsSL https://raw.githubusercontent.com/Jess-is-it/threejmain/master/scripts/production_bootstrap.sh | sudo env THREEJMAIN_PUBLIC_HOST=192.168.50.80 bash
curl -fsSL https://raw.githubusercontent.com/Jess-is-it/threejmain/master/scripts/production_bootstrap.sh | sudo env THREEJMAIN_REPO_URL=git@github.com:Jess-is-it/threejmain.git bash
```

If the repository is private, configure SSH access or use an authenticated clone URL before running the installer with `THREEJMAIN_REPO_URL`.

For non-interactive installs, provide owner credentials through environment variables:

```bash
curl -fsSL https://raw.githubusercontent.com/Jess-is-it/threejmain/master/scripts/production_bootstrap.sh | sudo env THREEJMAIN_OWNER_USERNAME=owner THREEJMAIN_OWNER_EMAIL=owner@example.com THREEJMAIN_OWNER_CONTACT=639171234567 THREEJMAIN_OWNER_PASSWORD='change-this-password' bash
```

Production is deployed from `origin/master` on the same host as the shared development checkout, but it uses a separate checkout and Docker Compose project:

- Source/development checkout: `/home/threejmain`
- Production checkout: `/home/threejmain-production`
- Production Compose project: `threejmain-production`
- Production branch: `master`
- Production web URL: `http://192.168.50.70:8180/`
- Production API URL: `http://192.168.50.70:8100/`

The production Compose project creates its own Docker volumes, so production data is not shared with the old staging/test Compose project. The deploy script stops the old `threejmain` Compose project before starting production because both stacks would otherwise compete for ports `8180` and `8100`.

Install or refresh the manual deploy control worker:

```bash
scripts/install_production_deploy_control.sh
```

The deploy control worker writes the latest 10 `master` commits and deployment status into the production API data volume. `System Settings -> Runtime -> Production Deployment` reads that status and queues selected commits for upgrade or rollback. The installer disables the old auto-deploy watcher to prevent it from overriding a manual rollback.

Install or refresh the old master watcher only if you want automatic deploys on every `master` change:

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

`scripts/production_deploy.sh` loads production environment values from `/home/threejmain/.env` by default. Override with `THREEJMAIN_PROD_ENV_FILE=/path/to/env` when needed.

Useful service checks:

```bash
systemctl status threejmain-production-auto-deploy.service
journalctl -u threejmain-production-deploy-control.service -n 100 --no-pager
systemctl status threejmain-production-deploy-control.service
journalctl -u threejmain-production-auto-deploy.service -n 100 --no-pager
docker compose --project-name threejmain-production -f /home/threejmain-production/docker-compose.yml ps
```
