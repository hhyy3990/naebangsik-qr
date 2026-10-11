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

모든 신규 접근성 설정 요청과 프로필에는 `schemaVersion: 3`이 포함됩니다. 하단 조작 모드는 `viewportMode`에 사용하지 않음 또는 60·70·80%로 저장됩니다. 기존 v1/v2 프로필은 QR 토큰과 다른 접근성 값을 유지하며, 조회 응답에서는 이전 하단 조작 값을 `viewportMode: null`로 정규화합니다.

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
