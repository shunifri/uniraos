# SSL Certificates

Place your production SSL certificates in this directory:

- `cert.pem` — Server certificate (or full chain)
- `key.pem` — Private key

## Self-signed certificate for local development

Generate a self-signed certificate with:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout key.pem \
  -out cert.pem \
  -subj "/CN=localhost"
```
