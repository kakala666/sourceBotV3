import { Router, type IRouter } from 'express';
import { BotSubscriptionGateService } from '../services/bot-subscription-gate.service';
import { touchReloadSignal } from '../services/bot-reload-signal';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

function serialize(gate: any) {
  return {
    id: gate.id,
    botId: gate.botId,
    isEnabled: gate.isEnabled,
    promptTemplate: gate.promptTemplate,
    sponsorPositions: gate.sponsorPositions ?? [],
    channels: (gate.channels ?? []).map((c: any) => ({
      id: c.id,
      kind: c.kind,
      isPrivate: c.isPrivate,
      username: c.username,
      chatId: c.chatId.toString(),
      title: c.title,
      inviteUrl: c.inviteUrl,
      sortOrder: c.sortOrder,
      status: c.status,
      lastCheckAt: c.lastCheckAt,
    })),
  };
}

router.get('/:botId/subscription-gate', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const gate = await BotSubscriptionGateService.getOrCreate(botId);
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:botId/subscription-gate', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { isEnabled, promptTemplate } = req.body ?? {};
    const data: any = {};
    if (typeof isEnabled === 'boolean') data.isEnabled = isEnabled;
    if (promptTemplate !== undefined) {
      data.promptTemplate = typeof promptTemplate === 'string' && promptTemplate.trim()
        ? promptTemplate.trim()
        : null;
    }
    const gate = await BotSubscriptionGateService.update(botId, data);
    touchReloadSignal();
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/:botId/subscription-gate/channels', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { inviteUrl, chatId, kind } = req.body ?? {};
    if (!inviteUrl) return fail(res, '请提供 inviteUrl', 400);
    await BotSubscriptionGateService.addChannel(botId, inviteUrl, chatId, kind ?? 'primary');
    touchReloadSignal();
    const gate = await BotSubscriptionGateService.getOrCreate(botId);
    return success(res, serialize(gate), 201);
  } catch (err: any) {
    if (err.code === 'P2002') return fail(res, '该频道已添加', 409);
    return fail(res, err.message, 400);
  }
});

router.delete('/:botId/subscription-gate/channels/:channelId', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const channelId = parseInt(req.params.channelId);
    await BotSubscriptionGateService.removeChannel(botId, channelId);
    touchReloadSignal();
    return success(res);
  } catch (err: any) {
    return fail(res, err.message, 404);
  }
});

router.post('/:botId/subscription-gate/channels/:channelId/recheck', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const channelId = parseInt(req.params.channelId);
    const channel = await BotSubscriptionGateService.recheckChannel(botId, channelId);
    touchReloadSignal();
    return success(res, {
      id: channel.id,
      status: channel.status,
      title: channel.title,
      lastCheckAt: channel.lastCheckAt,
    });
  } catch (err: any) {
    return fail(res, err.message, 400);
  }
});

router.put('/:botId/subscription-gate/sponsor-positions', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { positions } = req.body ?? {};
    const gate = await BotSubscriptionGateService.updateSponsorPositions(botId, positions);
    touchReloadSignal();
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 400);
  }
});

router.put('/:botId/subscription-gate/channels/reorder', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { orderedIds } = req.body ?? {};
    await BotSubscriptionGateService.reorderSponsorChannels(botId, orderedIds);
    touchReloadSignal();
    const gate = await BotSubscriptionGateService.getOrCreate(botId);
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 400);
  }
});

export default router;
