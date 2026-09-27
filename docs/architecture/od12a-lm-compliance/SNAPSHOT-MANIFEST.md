# OD-12-A snapshot manifest

Captured: 2026-09-27
Capture method: PowerShell `Invoke-WebRequest -UseBasicParsing -OutFile <snapshot>`; hashes are SHA-256 of the stored bytes.
Purpose: immutable evidence bundle for factual Lantmäteriet terms/product mapping.
Rule: a source URL is not evidence by itself; each local snapshot is bound by SHA-256 below.

| Snapshot | Source URL | SHA-256 |
| --- | --- | --- |
| villkor-och-avgifter.html | https://www.lantmateriet.se/sv/geodata/vara-produkter/Villkor-och-avgifter/ | C1A2B4C8D2EBED533C0C66991E5FB3DA68484A8C7212EB8D85E97C1BA0F6A6AA |
| vardefulla-datamangder.pdf | https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder.pdf | 8017FED096569198001949A259D96A95D9AA2F09E1A974DF7ACB14C0A7D6216D |
| vardefulla-datamangder-personuppgifter.pdf | https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder_pu.pdf | 44FE3E9048448B8AF88FF5DBD2A16A75727083B71F70FA05C435340556026321 |
| om-tillhandahallandet.html | https://www.lantmateriet.se/sv/geotorget-produktstod/om-tillhandahallandet/ | F949B0E7937DD5A7C6D2250DF88279546AA408547BB9AF4F8E28922155746691 |
| fastighetsindelning-direkt-doc.html | https://geotorget.lantmateriet.se/dokument/projects/fastighetsindelning-direkt/released/1.0/ | 6FEAD57EEEEBFC897B821C80B067E504E1B70B2F28A54F6FD32DD75F0140C295 |
| fastighetsindelning-nedladdning-2025-02-doc.html | https://geotorget.lantmateriet.se/dokument/projects/fastighetsindelning-nedladdning-vektor/released/2025.02/ | 4839A25495B1F12DF89B9911EB03171958F154AA8D444A1EEC74DA8460E96718 |
| fastighet-samfallighet-direkt-doc.html | https://geotorget.lantmateriet.se/dokumentation/display/4.html | B0DC568C55507CA4CFF69F05098176A36CB78405BC485245A9742FAEA12E4C87 |
| belagenhetsadress-direkt.html | https://geotorget.lantmateriet.se/dokument/projects/belaegenhetsadress-direkt/released/4.2/ | 020FA970787D50240C3C2B8D30FF45271AAE790E1ACA74626D21CF803443EC6E |
| avgifter-leverans-2026.pdf | https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/avgifter_och_leveransinformation_for_geodata.pdf | 5457F0BE668C14DF1046E5FE24C9B4E5DC64A7590D526D207026366FCCD4CB9E |
| hydrografi-i-natverk.html | https://www.lantmateriet.se/sv/geodata/vara-produkter/Hydrografi-i-natverk/ | A395372357CD72F89AB368CFB0788E4392816A3846B27EB538ABB21B2E83329D |
| hydrografi-nedladdning-licensvillkor.pdf | https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/licensvillkor-hydrografi-nedladdning.pdf | 4525AD64B3B1EBA35EAF5B6B53CD6393E939B798C153E81C5BE811C8D6DDE72F |
