# Sampark PowerPoint template inspector (temporary, read-only)

**Branch:** feature/sampark-ppt-template-inspector-20261028

Purpose: inspect a new Samsung PowerPoint template **locally**, without uploading it or copying its slide text or embedded image pixels. This folder does not change the application's PowerPoint exporter, UI, routing, API, or deployment.

## What is produced

- template_structure.json — exact slide/shape coordinates in inches and percentages, margins, explicit font/run styles, paragraph formatting, auto-fit settings, picture box geometry and image pixel dimensions, template layouts/masters, theme font/color maps and recognized old Sampark marker names.
- template_geometry.html — a **schematic** outline of text and image regions, not a faithful slide render.
- REVIEW_BEFORE_SHARING.txt — privacy reminder.
- sampark_template_inspection_REVIEW_BEFORE_SHARING.zip — JSON, HTML and privacy note only.

**NOT included:** the PowerPoint file, article or slide text, notes, image bytes, media, screenshots or shape names. Layout names, font families, colors and geometry can still be confidential. Inspect the contents under your company's sharing rules before sharing anything.

## Safe Windows workflow — development PC only

Use C:\scrappyV3. Do not touch C:\App_Portable, backend files or the production build.

1. On GitHub, open this branch's inspect_template.py and use the **Raw** button to save the file to:

       C:\scrappyV3\scripts\sampark_ppt_template_inspector\inspect_template.py

   If this directory does not exist, create it. This maps from GitHub
   legacy_app/scripts/... to the developer PC scripts/... directory.
   Do not move or copy your confidential .pptx into Git.

2. In PowerShell, paste these commands. Use File Explorer **Copy as path**
   on the new PPTX and paste its full path when prompted:

       $template = (Read-Host "Paste the full path to your new PPTX").Trim('"')
       $out = "C:\Temp\SamparkPptAudit\output"
       New-Item -ItemType Directory -Force $out | Out-Null
       & "C:\scrappyV3\venv\Scripts\python.exe" "C:\scrappyV3\scripts\sampark_ppt_template_inspector\inspect_template.py" $template --out $out --max-slides 12

3. Open the schematic in your browser:

       Invoke-Item "C:\Temp\SamparkPptAudit\output\template_geometry.html"

4. Review the JSON and ZIP for sensitive information before sharing. The ZIP
   is NOT automatically uploaded anywhere; share only if permitted.

## If python-pptx isn't installed

Try the development environment first:

    & "C:\scrappyV3\venv\Scripts\python.exe" -c "import pptx; print(pptx.__version__)"

Only if missing, and if software installation is permitted:

    & "C:\scrappyV3\venv\Scripts\python.exe" -m pip install python-pptx

If you cannot install it on the managed laptop, report the error without
sharing the PPTX. Do not install into the portable server's embedded Python.

## Notes for the later PowerPoint implementation

- The current Sampark Create Report exporter is
  news_scrapper/reports/exports.py -> export_ppt(), reached via
  POST /reports/export/pptx.
- Legacy Draft Export uses POST /export-ppt and is a different path.
- New templates might have different layout names or ordinary textboxes in
  place of #TITLE, #SUMMARY, #INSIGHT, etc. This inspector reports both.
- Template geometry does NOT guarantee that text fits. PowerPoint handles
  font substitution, inherited styles, wrapping and line spacing. True fit
  needs a later renderer/validation step.
- Do not change the PowerPoint generation pipeline based on the schematic
  alone: map the new template and confirm local code parity first.

When done, delete the temporary audit output and inspector copy if required
by local security policy.
