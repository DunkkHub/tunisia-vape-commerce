import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const securityWorkflow = await readFile('.github/workflows/security.yml', 'utf8');
const ciWorkflow = await readFile('.github/workflows/ci.yml', 'utf8');
const stagingWorkflow = await readFile('.github/workflows/controlled-staging-images.yml', 'utf8');

test('security workflow preserves independent secret, image, SARIF and SBOM gates', () => {
  assert.match(
    securityWorkflow,
    /name: Scan repository secrets[\s\S]*?if: \$\{\{ always\(\) && steps\.checkout\.outcome == 'success' \}\}[\s\S]*?uses: gitleaks\/gitleaks-action@v3/u,
  );
  assert.match(securityWorkflow, /id: image_build/u);
  assert.match(
    securityWorkflow,
    /- name: migration\s+file: docker\/Dockerfile\.api\s+target: migration/u,
  );
  assert.match(securityWorkflow, /target: \$\{\{ matrix\.target \}\}/u);
  assert.match(securityWorkflow, /id: trivy/u);
  assert.match(securityWorkflow, /version: v0\.73\.0/u);
  assert.match(securityWorkflow, /severity: HIGH,CRITICAL/u);
  assert.match(securityWorkflow, /ignore-unfixed: false/u);
  assert.match(securityWorkflow, /limit-severities-for-sarif: true/u);
  assert.match(securityWorkflow, /exit-code: '1'/u);
  assert.match(
    securityWorkflow,
    /name: Verify Trivy SARIF output[\s\S]*?TRIVY_OUTCOME: \$\{\{ steps\.trivy\.outcome \}\}[\s\S]*?\[\[ -f "\$SARIF_FILE" \]\]/u,
  );
  assert.match(
    securityWorkflow,
    /name: Upload Trivy SARIF[\s\S]*?if: \$\{\{ always\(\) && steps\.trivy_sarif\.outputs\.exists == 'true' \}\}[\s\S]*?category: trivy-\$\{\{ matrix\.name \}\}/u,
  );
  assert.match(
    securityWorkflow,
    /name: Generate image SBOM[\s\S]*?if: \$\{\{ always\(\) && steps\.image_build\.outcome == 'success' \}\}/u,
  );
});

test('CI and controlled staging build the same slim migration target', () => {
  assert.match(
    ciWorkflow,
    /file: docker\/Dockerfile\.api\s+target: migration[\s\S]*?tags: vape-migration:ci/u,
  );
  assert.match(
    stagingWorkflow,
    /file: docker\/Dockerfile\.api\s+target: migration[\s\S]*?tags: ghcr\.io\/\$\{\{ github\.repository \}\}\/migration:sha-\$\{\{ github\.sha \}\}/u,
  );
});

test('controlled staging passes dispatch evidence through environment variables', () => {
  assert.match(stagingWorkflow, /CHANGE_REFERENCE: \$\{\{ inputs\.change_reference \}\}/u);
  assert.match(
    stagingWorkflow,
    /BACKUP_REHEARSAL_REFERENCE: \$\{\{ inputs\.backup_rehearsal_reference \}\}/u,
  );
  assert.match(stagingWorkflow, /test -n "\$CHANGE_REFERENCE"/u);
  assert.match(stagingWorkflow, /test -n "\$BACKUP_REHEARSAL_REFERENCE"/u);
  assert.doesNotMatch(stagingWorkflow, /test -n "\$\{\{ inputs\./u);
});
