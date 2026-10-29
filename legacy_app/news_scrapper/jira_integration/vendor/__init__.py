"""Place Guy X's original CDP/Jira modules in this directory.

Required (provided separately):
- cdp_browser.py
- cdp_api.py
- jira_ops.py
- config.py

Do not commit local browser profiles, tokens, or cookies.
The Jira adapter loads these files lazily; missing modules disable ticket creation.
"""
