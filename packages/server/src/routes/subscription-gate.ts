import { Router, type IRouter } from 'express';
import { SubscriptionGateService } from '../services/subscription-gate.service';
import { touchReloadSignal } from '../services/bot-reload-signal';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

function serialize(gate: any) {
  return {
    id: gate.id,
    inviteLinkId: gate.inviteLinkId,
    isEnabled: gate.isEnabled,
    promptTemplate: gate.promptTemplate,
    channels: (gate.channels ?? []).map((c: any) => ({
      id: c.id,
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

router.get('/:linkId/subscription-gate', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const gate = await SubscriptionGateService.getOrCreate(linkId);
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:linkId/subscription-gate', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const { isEnabled, promptTemplate } = req.body ?? {};
    const data: any = {};
    if (typeof isEnabled === 'boolean') data.isEnabled = isEnabled;
    if (promptTemplate !== undefined) {
      data.promptTemplate = typeof promptTemplate === 'string' && promptTemplate.trim()
        ? promptTemplate.trim()
        : null;
    }
    const gate = await SubscriptionGateService.update(linkId, data);
    touchReloadSignal();
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/:linkId/subscription-gate/channels', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const { inviteUrl, chatId } = req.body ?? {};
    if (!inviteUrl) return fail(res, '请提供 inviteUrl', 400);
    await SubscriptionGateService.addChannel(linkId, inviteUrl, chatId);
    touchReloadSignal();
    const gate = await SubscriptionGateService.getOrCreate(linkId);
    return success(res, serialize(gate), 201);
  } catch (err: any) {
    if (err.code === 'P2002') return fail(res, '该频道已添加', 409);
    return fail(res, err.message, 400);
  }
});

router.delete('/:linkId/subscription-gate/channels/:channelId', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const channelId = parseInt(req.params.channelId);
    await SubscriptionGateService.removeChannel(linkId, channelId);
    touchReloadSignal();
    return success(res);
  } catch (err: any) {
    return fail(res, err.message, 404);
  }
});

router.post('/:linkId/subscription-gate/channels/:channelId/recheck', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const channelId = parseInt(req.params.channelId);
    const channel = await SubscriptionGateService.recheckChannel(linkId, channelId);
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

export default router;
