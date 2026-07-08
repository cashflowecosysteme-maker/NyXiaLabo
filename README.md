# Sandbox IA — NyXia

Hub perso pour tester rapidement n'importe quel modèle (OpenRouter + futurs
fournisseurs) avant de l'intégrer dans un portail NyXia. Un seul Worker
Cloudflare, pas de build step, pas de dépendances.

## Déploiement (première fois)

```bash
npm install -g wrangler   # si pas déjà installé
wrangler login

# Crée le namespace KV pour stocker la config des fournisseurs
wrangler kv namespace create HUB_CONFIG
# → colle l'id retourné dans wrangler.toml (champ "id")

# Secrets (jamais dans le code, jamais dans KV)
wrangler secret put OPENROUTER_API_KEY
wrangler secret put ADMIN_TOKEN     # chaîne aléatoire longue, pour protéger /api/config

# Déploiement
wrangler deploy
```

Le Worker sert directement l'interface à la racine (`/`) — pas besoin d'un
projet Pages séparé pour ce sandbox.

## Ajouter ton deuxième fournisseur

Une fois que tu as le nom et la doc de ton 2e fournisseur, envoie une requête
`PUT /api/config` avec ta liste complète de fournisseurs (elle remplace
entièrement l'actuelle, donc renvoie aussi OpenRouter si tu veux le garder) :

```bash
curl -X PUT https://TON-WORKER.workers.dev/api/config \
  -H "X-Admin-Token: TON_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "providers": [
      {
        "id": "openrouter",
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_secret": "OPENROUTER_API_KEY",
        "format": "openai-compatible",
        "featured_models": [
          { "id": "anthropic/claude-sonnet-5", "label": "Claude Sonnet 5", "division": "conversation" }
        ]
      },
      {
        "id": "NOUVEAU_FOURNISSEUR",
        "name": "Nom affiché",
        "base_url": "https://api.exemple.com/v1",
        "api_key_secret": "NOM_DU_SECRET",
        "format": "openai-compatible",
        "featured_models": [
          { "id": "id-technique-du-modele", "label": "Nom affiché du modèle", "division": "conversation" }
        ]
      }
    ]
  }'
```

N'oublie pas de créer le secret correspondant avant :
```bash
wrangler secret put NOM_DU_SECRET
```

**Si le fournisseur n'est pas compatible OpenAI** (format de requête/réponse
différent — rare, mais possible), donne-moi sa doc API et j'ajoute un
adaptateur dédié dans `worker.js` (section `ADAPTERS`). Le reste du système
ne change pas.

## Divisions

Les onglets de l'interface (Conversation, Livre, Narration, etc.) sont
générés automatiquement à partir du champ `division` de chaque modèle dans
la config. Pour ajouter une division, ajoute simplement des modèles avec un
nouveau nom de `division` — aucune modification de code nécessaire.

## Notes

- `max_tokens` par défaut à 2000 dans l'UI — monte-le à 8000-10000 pour un
  chapitre complet (30k caractères ≈ 7-8k tokens).
- `/api/models?provider=openrouter` liste les 600+ modèles bruts
  d'OpenRouter si tu veux explorer au-delà des modèles "à l'affiche".
- Ce sandbox n'a pas de design NyXia — volontairement brut, usage interne
  seulement.
