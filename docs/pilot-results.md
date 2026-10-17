# ReadMate pilot results

Fill this in while working through the deployment and the manual device checklist
(spec §9 and §10). Tick a box only after seeing it work.

## Deployment record

- [ ] Token generated: `python -c "import secrets; print(secrets.token_hex(32))"` (do not paste it here)
- [ ] `sam build && sam deploy --guided` in `eu-central-1` (reserved concurrency removed: account limit is 10): ____
- [ ] Function URL: ____
- [ ] Frontend deployed to Amplify Hosting with `VITE_API_URL` = Function URL; site URL: ____
- [ ] SAM re-deployed with `FrontendOrigin` = site URL
- [ ] Budget alert subscription e-mail confirmed
- [ ] CloudWatch logs contain no token and no image data

## First-fixture check (plan Task 2, step 7)

- [ ] `scripts/capture_fixture.py <photo> book_page` run on the reference photo
- [ ] Textract word quality acceptable (notes): ____
- [ ] `backend/tests/fixtures/book_page.textract.json` committed; `test_reference_page_hyphen_pairs_merge` passes (no longer skipped)
- [ ] Newspaper (multi-column) fixture captured and added

## Manual device checklist

1. [ ] Android Chrome: install prompt appears, app launches standalone
2. [ ] iPhone Safari: Add to Home Screen, launches standalone
3. [ ] Camera and gallery both work on both phones
4. [ ] Portrait and landscape photos both display upright with aligned boxes
5. [ ] Airplane mode shows the offline message; a wrong token returns to the token prompt
6. [ ] Service worker registered on the deployed HTTPS site (could not be checked locally)

## Success criteria (spec §1)

| # | Criterion | Result |
|---|---|---|
| 1 | Reference photo + 10 real pages: every body word boxed, no drift at any zoom, no boxes in margins | |
| 2 | Hyphenated word (`Vorstel-` / `lungskraft`) selected as one word from either half, both halves highlight | |
| 3 | Photo → boxes visible in ≤ 5 s on typical 4G (measured: ____ s) | |
| 4 | Installs and runs full-screen on Android Chrome and iPhone Safari | |
| 5 | Monthly AWS cost < $1 with a $5 alert | |

## Notes

