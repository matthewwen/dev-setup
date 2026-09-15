# nginx

Route local apps by hostname, such as `http://docs.localhost/`.

`nginx.conf` is the main config copied from this machine. `hosts.conf` holds
hostname-based virtual servers, and `proxy-dev.conf` holds their shared proxy
settings. The installer symlinks the configs into `/etc/nginx`, so routes stay
version controlled. nginx runs as `user root`, so a webroot symlinked to a build
directory under `$HOME` serves without chmod.

## Install

Run:

```bash
./install.sh
```

The script:

- backs up the existing main config once as
  `/etc/nginx/nginx.conf.pre-dev-setup`
- symlinks `nginx.conf`, `hosts.conf`, and `proxy-dev.conf`
- runs `nginx -t`
- enables and starts nginx, or reloads it when already running

## Host-based apps

`hosts.conf` includes `docs.localhost`, which proxies to port 8002:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name docs.localhost;

    location / {
        proxy_pass http://127.0.0.1:8002;
        include /etc/nginx/proxy-dev.conf;
    }
}
```

Open `http://docs.localhost/`. Add another `server` block to expose another
local port under its own hostname. `proxy-dev.conf` carries the standard headers
plus websocket/HMR passthrough.

## Revert

Restore the config saved by the installer:

```bash
sudo rm -f /etc/nginx/nginx.conf
sudo mv /etc/nginx/nginx.conf.pre-dev-setup /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx
```

`/etc/nginx/nginx.conf.default` holds the stock upstream config if you ever want a
clean baseline. It is not a backup of your current file.
