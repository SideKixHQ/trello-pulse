# SideKix Trello Pulse

Dashboard for the SideKix Android, iOS App and Admin Panel Trello boards, published at https://sidekixhq.github.io/trello-pulse/.

A GitHub Action pulls the boards every 15 minutes (read only) and redeploys the page.
It needs two repository secrets: `TRELLO_KEY` and `TRELLO_TOKEN`
(Settings → Secrets and variables → Actions). Without them the page keeps showing the last data.
