# Needs GNU make. On Windows without make, run the PowerShell scripts directly.
PS = powershell -NoProfile -ExecutionPolicy Bypass -File

.PHONY: run run-fake test

run:        ## backend (real Textract) + frontend; Ctrl+C stops both
	$(PS) run.ps1

run-fake:   ## same, with the recorded fixture instead of AWS
	$(PS) run.ps1 -Engine fake

test:       ## backend + frontend tests
	cd backend && .venv/Scripts/python -m pytest -q
	cd frontend && npm test
