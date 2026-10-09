# 내 방식 QR

한 번 설정한 접근성 선호를 버전이 있는 프로필로 저장하고, QR로 다시 불러오는 웹 MVP입니다. 이름, 장애 유형, 주민등록번호, 연락처는 수집하지 않습니다.

## 실행

Replit의 PostgreSQL 연결을 사용합니다. `DATABASE_URL`은 실행 환경에서 제공되어야 합니다.

```sh
npm run dev
```

허용할 다른 웹 서비스의 주소가 있으면 `ALLOWED_ORIGINS` 환경 변수에 쉼표로 구분해 등록합니다. 같은 주소에서 실행되는 웹 화면 요청은 기본 허용됩니다.

## 확인 명령

```sh
npm run typecheck
npm test
npm run build
```

API 테스트는 실제 사용자 프로필과 구분되는 `is_test` 데이터로 실행하며, 테스트 종료 후 해당 레코드를 삭제합니다. 운영 환경에서는 테스트 데이터 생성이 차단됩니다.

## API

모든 접근성 설정 응답에는 `schemaVersion: 1`이 포함됩니다.

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
