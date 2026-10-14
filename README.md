# 내 방식 QR

한 번 설정한 접근성 선호를 버전이 있는 프로필로 저장하고, QR로 다시 불러오는 웹 MVP입니다. 이름, 장애 유형, 주민등록번호, 연락처는 수집하지 않습니다.

## 실행

Replit의 PostgreSQL 연결을 사용합니다. `DATABASE_URL`은 실행 환경에서 제공되어야 합니다.

```sh
npm run dev
```

허용할 다른 웹 서비스의 주소가 있으면 `ALLOWED_ORIGINS` 환경 변수에 쉼표로 구분해 등록합니다. 같은 주소에서 실행되는 웹 화면 요청은 기본 허용됩니다.

## QR 공개 링크와 배포

Preview에서 만드는 QR은 현재 Preview 주소를 사용하며, 외부 휴대폰에서는 Replit 로그인 화면이 나오거나 Preview 데이터가 없어 열리지 않을 수 있습니다. 공개 배포 후에는 Publishing 설정에서 앱 접근 권한을 `Public`으로 선택해야 누구나 QR 링크를 열 수 있습니다.

공개 배포의 Production 환경 변수에 `PUBLIC_APP_URL`을 설정하면 QR 링크가 해당 HTTPS 주소를 사용합니다. 값은 `https://앱의-공개-주소`처럼 사이트의 주소만 입력하고, 경로나 쿼리는 넣지 않습니다. 이 변수는 Production에서만 적용됩니다. 설정하지 않으면 공개 사이트가 접속된 주소를 사용합니다.

Preview와 Production은 별도의 데이터베이스를 사용합니다. Preview에서 만든 프로필은 공개 배포 데이터베이스에서 자동으로 조회되지 않으므로, 공개 사이트에서 새 QR을 만들어 사용하세요. 주소가 바뀌어도 이미 저장하거나 인쇄한 QR 이미지는 자동으로 바뀌지 않습니다. 공개 배포 후 새 QR 이미지를 저장해 교체해야 합니다.

## 확인 명령

```sh
npm run typecheck
npm test
npm run build
```

API 테스트는 실제 사용자 프로필과 구분되는 `is_test` 데이터로 실행하며, 테스트 종료 후 해당 레코드를 삭제합니다. 운영 환경에서는 테스트 데이터 생성이 차단됩니다.

## API

모든 신규 접근성 설정 요청과 프로필에는 `schemaVersion: 4`가 포함됩니다. 하단 조작 모드는 `viewportMode`에 사용하지 않음 또는 60·70·80%로 저장됩니다. 기존 v1/v2/v3 프로필은 QR 토큰과 저장 데이터를 유지하며, 조회 응답에서는 구버전 하단 조작 설정을 `viewportMode: null`로 정규화하고 v4 신규 값은 안전한 기본값으로 채웁니다. 조회만으로 기존 데이터를 수정하거나 버전을 올리지 않습니다.

### QR 프로필 v4 SDK 계약

`POST /api/profiles/resolve` 성공 응답은 `{ "schemaVersion": 4, "preferences": { ... }, "updatedAt": "ISO-8601" }` 모양입니다. 토큰은 요청에만 쓰이며 응답에는 포함되지 않습니다. `preferences`에는 아래의 v3 설정 필드와 v4 필드가 포함됩니다.

```json
{
  "schemaVersion": 4,
  "preferences": {
    "textSize": "standard",
    "buttonSize": "standard",
    "contrast": "standard",
    "easyLanguage": false,
    "viewportMode": null,
    "smartGuide": false,
    "guideDelaySeconds": 15,
    "voiceGuidance": false,
    "language": "ko",
    "stepByStepGuidance": false,
    "conciseGuidance": false,
    "slowGuidance": false
  },
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`language`는 `ko | zh | vi | en | th | uz | ja` 중 하나이며 기본값은 `ko`; `stepByStepGuidance`, `conciseGuidance`, `slowGuidance`는 boolean이고 기본값은 모두 `false`입니다. `guideDelaySeconds`는 스마트 길잡이가 시작되기 전 대기 시간(10/15/20초)이며 `slowGuidance`는 표시 후 15초 유지 선호로 서로 다른 설정입니다. 기존 v1~v3 프로필은 읽을 때 언어를 `ko`, 신규 안내 선호를 `false`로 정규화하며, 저장 JSONB·QR 토큰은 변경하지 않습니다. v4 필드를 무시하는 구형 SDK가 신규 설정을 반영하지 않을 수 있으므로 SDK 버전을 확인한 뒤 적용해야 합니다. 현재 중앙 서비스에 값을 저장하는 것만으로 키오스크 기능이 이미 지원된다고 보장하지 않습니다.

- `GET /api/public-config` — Preview 또는 공개 배포의 QR 주소 기준 확인
- `POST /api/profiles` — 프로필과 QR 조회 토큰, 별도 관리 코드를 생성
- `POST /api/profiles/resolve` — QR 토큰으로 공개 설정만 조회
- `GET /api/profiles/:id/manage` — 관리 코드로 본인 설정 조회
- `PATCH /api/profiles/:id` — 관리 코드로 설정 수정
- `POST /api/profiles/:id/rotate` — 기존 QR 토큰을 무효화하고 새 토큰 발급
- `POST /api/profiles/:id/revoke` — 현재 QR 토큰 폐기

QR 토큰은 해시로만 저장하며, 관리 코드도 해시로만 저장합니다. 관리 코드는 생성 시 한 번 전달되며 QR에는 포함하지 않습니다. QR 토큰만 가진 사람은 설정을 수정하거나 폐기할 수 없습니다.

## 파일 구조

```text
src/
  App.tsx                 접근성 프로필 만들기·관리·QR 조회 화면
  index.css               기본 디자인 및 접근성 스타일
  lib/profile.ts          버전이 있는 설정 타입과 API 클라이언트
server/
  app.ts                  Express API, 입력 검증, 권한 및 토큰 처리
  index.ts                웹/API 서버 시작점
  schema.sql              PostgreSQL 프로필 스키마
  app.test.ts             프로필 API 통합 테스트
```
