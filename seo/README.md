# Catalogue SEO — meta descriptions

`meta-descriptions-deploy.csv` replaces the machine-generated meta descriptions on
183 live products. It is **product data, not theme code** — it is applied in Shopify
admin (Products → Import), not by deploying the theme or pushing to GitHub.

Import it after taking a CSV export of your current products as a rollback point.

| File | What it is |
| --- | --- |
| `meta-descriptions-deploy.csv` | **The import file.** 183 rows, `Handle` + `SEO Description` only. |
| `meta-descriptions-audit.csv` | All five columns side by side (live, AI suggestion, corrected) plus the facts each row used. |
| `REVIEW.md` | Why the earlier `deployment_ready.csv` was rejected, with the measurements. |
| `build-meta-descriptions.py` | Regenerates the file from a source CSV. No dependencies beyond the standard library. |

## Why there is no `Title` column

Shopify matches imports on `Handle`. A `Title` column would silently overwrite your
product titles, so it is deliberately omitted — importing this file can only change
the SEO description field.

## Facts this file relies on

* Free shipping over $50 — your published policy, used in the call to action.
* Only facts already present in a row's own title, type or existing copy are used.
  Nothing is invented.

Regenerate after any brand or policy change:

```bash
python3 seo/build-meta-descriptions.py    # reads the source CSV path at the top
```
