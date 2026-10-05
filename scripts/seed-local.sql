-- Local development data used by demo/index.html (data-project="pk_demo").
INSERT OR IGNORE INTO workspaces (id, kind, name, plan) VALUES ('user_dev', 'personal', 'Dev workspace', 'pro');
INSERT OR IGNORE INTO projects (id, workspace_id, name, public_key, identity_secret, comment_mode, allowed_origins)
VALUES ('demo', 'user_dev', 'Demo site', 'pk_demo', 'sk_demo_identity_secret', 'guests', '[]');
