# Fabric Public Projections and Search

This document explains the public-facing search and projection model.

## Projection model

- Canonical Units and Requests are the source records.
- Public marketplace visibility is implemented through derived projections:
  - public listings
  - public requests

## Public data rules

Public projections may include:
- title and summary text
- scope and category metadata
- non-sensitive resource descriptors
- coarse location or region data where applicable

Public projections do not include:
- contact info
- addresses
- precise geo

## Publish model

- Publish-ready creates can become public automatically.
- Drafts remain private until published.
- Unpublish removes the object from public discovery.

## Search model

Fabric exposes two public search endpoints:
- `POST /v1/search/listings`
- `POST /v1/search/requests`

Search is:
- authenticated
- credit-metered
- cursor-paginated

## Scope model

Search and publication use these public scope categories:
- `local_in_person`
- `remote_online_service`
- `ship_to`
- `digital_delivery`
- `OTHER`

Each scope determines which public fields and filters are relevant.

## Public search expectations

- Listings search is for acquirer intent.
- Requests search is for provider intent.
- Public node inventory endpoints support follow-up exploration after discovery.
- Category drilldowns support narrower follow-up exploration of a node's public inventory.

## Privacy expectation

Fabric's public search and projection model is designed so marketplace discovery can happen without exposing direct contact details or precise location.
