---
title: "How to Deploy Laravel on a Hostinger VPS (Nginx, PHP 8.3, MySQL, Redis, Queues)"
description: "Step-by-step, production-ready guide to deploying a Laravel app on a Hostinger KVM VPS with Ubuntu, Nginx, PHP-FPM, MySQL, Redis, Supervisor and free SSL."
slug: deploy-laravel-hostinger-vps
---

# How to Deploy Laravel on a Hostinger VPS (Nginx, PHP 8.3, MySQL, Redis, Queues)

> **Disclosure:** This guide contains affiliate links. If you buy a VPS through them I may earn a commission at no cost to you. The steps work on any Ubuntu VPS.

This is the exact process I use to put a Laravel app into production on a fresh VPS. It takes about 30–45 minutes the first time. By the end you'll have:

- Ubuntu with a firewall and a non-root deploy user
- Nginx + PHP-FPM 8.3 + OPcache
- MySQL 8 and Redis
- Your app deployed from Git
- Queue workers managed by Supervisor
- The scheduler running via cron
- Free HTTPS from Let's Encrypt

I'm using a [Hostinger KVM VPS]({{HOSTINGER_LINK}}) because it's cheap for the specs, but any Ubuntu 24.04 server works.

## Step 0: Choose the VPS and OS

For a small production app, 1–2 vCPU and 2–4 GB RAM is comfortable when MySQL and Redis run on the same machine. In the Hostinger panel, choose a plain **Ubuntu 24.04** template (not a control-panel template — we'll configure things ourselves). Pick the data center closest to your users.

Add your SSH public key during setup so you never need password logins.

## Step 1: Secure the server

SSH in as root:

```bash
ssh root@YOUR_SERVER_IP
apt update && apt upgrade -y
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Disable root and password login in `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
systemctl restart ssh
ufw allow OpenSSH
ufw allow 'Nginx Full'   # run after installing nginx, or allow 80/443
ufw enable
```

From now on, log in as `deploy`.

## Step 2: Install Nginx, PHP 8.3 and extensions

Ubuntu 24.04 ships PHP 8.3, so no extra repository is needed:

```bash
sudo apt install -y nginx php8.3-fpm php8.3-cli php8.3-mysql php8.3-mbstring \
  php8.3-xml php8.3-bcmath php8.3-curl php8.3-zip php8.3-intl php8.3-redis \
  php8.3-gd unzip git
```

Install Composer:

```bash
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer
```

Tune OPcache in `/etc/php/8.3/fpm/conf.d/10-opcache.ini`:

```
opcache.enable=1
opcache.memory_consumption=256
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0
```

`validate_timestamps=0` means PHP won't check files for changes — fast, but you must reload PHP-FPM on each deploy (we'll do that).

## Step 3: MySQL and Redis

```bash
sudo apt install -y mysql-server redis-server
sudo mysql_secure_installation
sudo mysql
```

```sql
CREATE DATABASE myapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'myapp'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON myapp.* TO 'myapp'@'localhost';
FLUSH PRIVILEGES;
```

Redis listens on localhost by default — keep it that way. Make sure `supervised systemd` is set in `/etc/redis/redis.conf`, then `sudo systemctl restart redis`.

## Step 4: Get your code onto the server

```bash
sudo mkdir -p /var/www/myapp
sudo chown deploy:www-data /var/www/myapp
cd /var/www/myapp
git clone git@github.com:you/myapp.git .
composer install --no-dev --optimize-autoloader
cp .env.example .env
php artisan key:generate
```

Edit `.env`:

```
APP_ENV=production
APP_DEBUG=false
APP_URL=https://example.com
DB_DATABASE=myapp
DB_USERNAME=myapp
DB_PASSWORD=a-long-random-password
CACHE_STORE=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis
```

Permissions and first build:

```bash
sudo chown -R deploy:www-data storage bootstrap/cache
sudo chmod -R 775 storage bootstrap/cache
php artisan migrate --force
php artisan storage:link
php artisan optimize
```

(Build frontend assets with `npm ci && npm run build` locally or in CI, or install Node on the server.)

**Never set `APP_DEBUG=true` in production** — it leaks environment variables on error pages.

## Step 5: Configure Nginx

Create `/etc/nginx/sites-available/myapp`:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    root /var/www/myapp/public;
    index index.php;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    charset utf-8;
    client_max_body_size 20M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Point your domain's A record to the VPS IP, then visit `http://example.com`.

## Step 6: Free SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

Certbot edits the Nginx config, adds an HTTP→HTTPS redirect, and installs a renewal timer. Test it with `sudo certbot renew --dry-run`.

## Step 7: Queue workers with Supervisor

```bash
sudo apt install -y supervisor
```

`/etc/supervisor/conf.d/myapp-worker.conf`:

```ini
[program:myapp-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/myapp/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
user=deploy
numprocs=2
redirect_stderr=true
stdout_logfile=/var/www/myapp/storage/logs/worker.log
stopwaitsecs=3600
```

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status
```

If you use Horizon, replace the command with `php artisan horizon` and use `numprocs=1`.

## Step 8: The scheduler

```bash
crontab -e
```

```
* * * * * cd /var/www/myapp && php artisan schedule:run >> /dev/null 2>&1
```

## Step 9: A simple deploy script

Save as `/var/www/myapp/deploy.sh`:

```bash
#!/usr/bin/env bash
set -e
cd /var/www/myapp
php artisan down --retry=15 || true
git pull origin main
composer install --no-dev --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan optimize
sudo systemctl reload php8.3-fpm
php artisan queue:restart
php artisan up
```

Allow the reload without a password by adding to `sudo visudo`:

```
deploy ALL=NOPASSWD: /bin/systemctl reload php8.3-fpm
```

This has a few seconds of maintenance mode. For true zero downtime, use release folders with a symlink swap (Deployer, Envoyer, Forge, or Ploi do this for you).

## Step 10: Backups and monitoring

- Turn on **automatic backups/snapshots** in the Hostinger panel.
- Dump the database nightly offsite, e.g. with `spatie/laravel-backup` to S3-compatible storage.
- Watch `storage/logs/laravel.log`, and add free uptime monitoring.
- Run `sudo apt upgrade` regularly, or enable `unattended-upgrades` for security patches.

## Troubleshooting

- **502 Bad Gateway:** PHP-FPM isn't running or the socket path is wrong. Check `systemctl status php8.3-fpm`.
- **500 with a blank page:** permissions on `storage/` or `bootstrap/cache`, or a missing `APP_KEY`. Check `storage/logs/laravel.log`.
- **Code changes don't show:** OPcache with `validate_timestamps=0` — reload PHP-FPM.
- **Jobs stuck:** `sudo supervisorctl status`, then `php artisan queue:restart` after every deploy.

## Step 11: Production hardening checklist

Before you announce the launch, run through this list. Each item takes a minute or two and prevents the most common production incidents I've seen on Laravel servers:

- **Swap file.** Small VPS plans can run out of memory during `composer install`. Add 1–2 GB of swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, then add it to `/etc/fstab`.
- **Fail2ban.** `sudo apt install fail2ban` blocks IPs that brute-force SSH. With key-only login you're already safe, but it keeps logs clean.
- **Log rotation.** Set `LOG_CHANNEL=daily` and `LOG_DAILY_DAYS=14` in `.env` so `storage/logs` doesn't fill the disk.
- **PHP-FPM pool size.** In `/etc/php/8.3/fpm/pool.d/www.conf`, set `pm.max_children` based on RAM: roughly (available RAM for PHP) ÷ (average PHP process size, often 40–80 MB).
- **MySQL memory.** On a 2–4 GB server, set `innodb_buffer_pool_size` to about 25–40% of RAM so MySQL and PHP don't fight for memory.
- **Health check route.** Laravel 11+ ships a `/up` route — point your uptime monitor at it.
- **Test a restore.** A backup you've never restored is a hope, not a backup. Restore a database dump to a local machine once.

With these in place, a single modest VPS comfortably serves thousands of daily users for a typical Laravel CRUD or API app.

## Is a VPS right for you?

If you followed this and enjoyed it, a [Hostinger VPS]({{HOSTINGER_LINK}}) will give you excellent value. If you'd rather never touch `sshd_config`, look at a managed option like [Cloudways]({{CLOUDWAYS_LINK}}) or put [Ploi]({{PLOI_LINK}}) / Laravel Forge on top of your VPS to automate steps 2–9. My [comparison of Laravel hosting options](/reviews/best-hosting-for-laravel) covers the trade-offs.
