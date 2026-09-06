# Studio employee invitations

Studio owners and administrators invite employees from **Studio → Employees**. Enter the employee's email address, create the invitation, then copy the returned link. When SMTP is configured, the same explicit action also sends the link through the configured transactional email provider.

The employee opens the link and signs in or creates an account with the invited email address. Sunrise verifies the bound email, pending status, and expiry before showing the invitation and verifies them again on acceptance. A successful acceptance selects the invited Studio's shared default Space and opens Studio, where the employee can choose a configured job role and provision their own persistent specialists.

Acceptance creates membership only in that Studio's default shared Space. Existing personal Spaces remain intact, and private sibling Spaces are not granted. The invitation endpoint fixes the organization and role on the server; browser input cannot request another organization or an owner/admin role. Used and expired invitations cannot be replayed.

Email delivery is optional. Without SMTP, the administrator must send the copied link through an appropriate channel. The invitation itself expires after 48 hours.
