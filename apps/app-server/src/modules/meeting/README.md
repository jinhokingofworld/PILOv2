# Meeting Module

Owner: 진호

API contract: `docs/api/meeting-api.md`

범위:

- 고정 Workspace 회의 페이지
- meeting room lifecycle
- participant 상태
- recording과 meeting report

주의:

- LiveKit 음성 회의 처리는 meeting 도메인에서 다룬다.
- app-level realtime 알림과 상태 전파는 realtime-server 책임이다.
