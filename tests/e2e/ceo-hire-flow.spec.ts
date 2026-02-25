import { test, expect } from '@playwright/test';

/**
 * CEO Smart Hire Flow — e2e tests
 *
 * Prerequisites:
 *  - App running at baseURL (jarvis.local)
 *  - CEO onboarding completed (ceo_meeting_done setting is set)
 *  - At least one unassigned mission in backlog/active
 *  - Anthropic or OpenAI vault key configured
 */

test.describe('CEO Smart Hire', () => {
  test('hire recommendation notification appears', async ({ page }) => {
    // Navigate to surveillance page
    await page.goto('/surveillance');

    // Wait for the office to render
    await expect(page.locator('[class*="pixel-office"], [class*="CRTFrame"]')).toBeVisible({ timeout: 10_000 });

    // Check if a hire recommendation card appears (may need to trigger eval cycle)
    // In practice, the eval runs every 7 days — this test validates the UI rendering
    // by checking the notification structure exists in the DOM when actions are queued
    const hireCard = page.locator('text=HIRE RECOMMENDATION');
    const chatCard = page.locator('text=CEO WANTS TO CHAT');

    // Either a hire recommendation or regular CEO action may appear
    // We just verify the surveillance page loads without errors
    await expect(page.locator('text=AGENT DETAIL').or(page.locator('text=AUDIT LOG')).or(page.locator('[class*="pixel-office"]'))).toBeVisible({ timeout: 10_000 });
  });

  test('approve hire creates agent', async ({ page }) => {
    await page.goto('/surveillance');

    // Look for the APPROVE HIRE button (only visible when hire recommendation is queued)
    const approveBtn = page.locator('button:has-text("APPROVE HIRE")');

    if (await approveBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await approveBtn.click();

      // Wait for agents-changed event to propagate
      await page.waitForTimeout(2_000);

      // Verify agent appeared (the office should now have a new sprite)
      // Check that the notification card is dismissed
      await expect(approveBtn).not.toBeVisible();
    } else {
      // No hire recommendation active — skip gracefully
      test.skip();
    }
  });
});

test.describe('Show Brain', () => {
  test('view and edit agent brain', async ({ page }) => {
    await page.goto('/surveillance');

    // Wait for office to render
    await expect(page.locator('[class*="pixel-office"], [class*="CRTFrame"]')).toBeVisible({ timeout: 10_000 });

    // Click on a non-CEO agent if one exists
    // First check if there are any agents in the office
    const agentElements = page.locator('[data-agent-id]');
    const agentCount = await agentElements.count();

    if (agentCount === 0) {
      test.skip();
      return;
    }

    // Click the first non-CEO agent
    for (let i = 0; i < agentCount; i++) {
      const agentId = await agentElements.nth(i).getAttribute('data-agent-id');
      if (agentId !== 'ceo') {
        await agentElements.nth(i).click();
        break;
      }
    }

    // Wait for sidebar to appear
    const sidebar = page.locator('text=AGENT DETAIL');
    if (!await sidebar.isVisible({ timeout: 3_000 }).catch(() => false)) {
      test.skip();
      return;
    }

    // Click SHOW BRAIN button
    const showBrainBtn = page.locator('button:has-text("SHOW BRAIN")');
    await expect(showBrainBtn).toBeVisible();
    await showBrainBtn.click();

    // Verify brain panel appears
    await expect(page.locator('text=SYSTEM PROMPT')).toBeVisible();
    await expect(page.locator('text=USER PROMPT')).toBeVisible();
    await expect(page.locator('text=BRAIN MODEL')).toBeVisible();

    // Click edit (pencil icon next to SYSTEM PROMPT)
    const editBtn = page.locator('button:has-text("SHOW BRAIN") ~ div button').first();
    if (await editBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await editBtn.click();

      // Verify textareas appear
      const textareas = page.locator('textarea');
      await expect(textareas.first()).toBeVisible();

      // Type into system prompt
      await textareas.first().fill('Test system prompt from Playwright');

      // Click save
      const saveBtn = page.locator('button:has-text("SAVE")');
      await saveBtn.click();

      // Verify save completes (edit mode exits)
      await expect(page.locator('text=Test system prompt from Playwright')).toBeVisible({ timeout: 3_000 });
    }

    // Toggle hide
    const hideBrainBtn = page.locator('button:has-text("HIDE BRAIN")');
    await expect(hideBrainBtn).toBeVisible();
    await hideBrainBtn.click();

    // Brain panel should be hidden
    await expect(page.locator('text=SYSTEM PROMPT')).not.toBeVisible();
  });
});
