# Stores

A store is an isolated payment channel backed by its own Monero **account** (major index). Accounts in the same wallet are unlinkable on-chain, so two stores cannot be correlated from blockchain data.

## Create a store

`POST /api/admin/stores` requires a session.

```bash
curl -X POST http://localhost:3000/api/admin/stores \
  -b 'pay_session=<token>' \
  -H 'content-type: application/json' \
  -d '{"name":"Storefront A","slug":"storefront-a"}'
```

```json
{"store":{"id":"...","name":"Storefront A","slug":"storefront-a","accountIndex":1,"createdAt":"..."}}
```

This creates a Monero account and cannot be undone through the API.

## Scope an API key

Pass `storeId` when creating a key:

```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -b 'pay_session=<token>' \
  -H 'content-type: application/json' \
  -d '{"name":"store-a","scopes":"payment:write,payment:read","storeId":"<store id>"}'
```

That key can only create and list links for its store. Webhooks registered with it only receive that store's events.

## Isolation guarantees

- A scoped key cannot list another store's links.
- A status token from store A cannot read store B's link.
- Subaddresses come from different Monero accounts, so on-chain observers cannot link the stores.
- Global keys and sessions can access every store.
