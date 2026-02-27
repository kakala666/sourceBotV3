import { Typography, Anchor, Divider, Alert } from 'antd';

const { Title, Paragraph, Text, Link } = Typography;

export default function Manual() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <Typography>
        <Title level={2}>Telegram 资源预览机器人 — 使用手册</Title>
        <Paragraph type="secondary">
          本手册面向机器人的日常维护者，帮助你快速上手后台的各项功能。
        </Paragraph>

        <Divider />

        <Title level={4}>目录</Title>
        <Paragraph>
          <ol>
            <li><a href="#login">登录后台</a></li>
            <li><a href="#bots">机器人管理</a></li>
            <li><a href="#links">邀请链接</a></li>
            <li><a href="#resources">资源管理</a></li>
            <li><a href="#contents">内容配置</a></li>
            <li><a href="#ads">广告配置</a></li>
            <li><a href="#users">用户列表</a></li>
            <li><a href="#stats">统计报表</a></li>
            <li><a href="#settings">系统设置</a></li>
            <li><a href="#faq">常见问题</a></li>
          </ol>
        </Paragraph>

        <Divider />

        {/* 1. 登录后台 */}
        <Title level={3} id="login">1. 登录后台</Title>
        <Paragraph>
          打开后台地址，输入管理员账号和密码，点击「登录」即可进入。
        </Paragraph>
        <Paragraph>
          登录成功后会自动跳转到机器人管理页面。如果长时间没有操作，系统会自动退出登录，重新登录即可。
        </Paragraph>
        <Paragraph>
          右上角显示当前登录的管理员名称，点击旁边的「退出」按钮可以退出登录。
        </Paragraph>

        <Divider />

        {/* 2. 机器人管理 */}
        <Title level={3} id="bots">2. 机器人管理</Title>
        <Paragraph>
          <Text strong>位置：</Text> 左侧菜单 →「机器人管理」
        </Paragraph>
        <Paragraph>这里管理你所有的 Telegram 机器人。</Paragraph>

        <Title level={5}>添加机器人</Title>
        <Paragraph>
          <ol>
            <li>点击右上角「新增机器人」</li>
            <li>填写机器人名称（方便你自己辨认，随便起）</li>
            <li>填写机器人 Token（从 Telegram 的 @BotFather 获取）</li>
            <li>点击确定</li>
          </ol>
        </Paragraph>

        <Title level={5}>验证 Token</Title>
        <Paragraph>
          添加完成后，建议点一下该机器人那行的「验证」按钮，系统会自动连接 Telegram 检查这个 Token 是否有效。验证通过后会自动填入机器人的 @用户名。
        </Paragraph>

        <Title level={5}>启用 / 停用</Title>
        <Paragraph>
          每个机器人有一个开关，打开表示该机器人正在运行，关闭则暂停服务。停用后用户发消息给这个机器人不会有任何响应。
        </Paragraph>

        <Title level={5}>编辑和删除</Title>
        <Paragraph>
          <ul>
            <li>点击「编辑」可以修改名称或更换 Token</li>
            <li>点击「删除」会永久移除该机器人及其所有关联数据，请谨慎操作</li>
          </ul>
        </Paragraph>

        <Divider />

        {/* 3. 邀请链接 */}
        <Title level={3} id="links">3. 邀请链接</Title>
        <Paragraph>
          <Text strong>位置：</Text> 机器人管理页面 → 某个机器人的「管理链接」按钮
        </Paragraph>
        <Paragraph>
          每个机器人可以创建多条邀请链接。不同的链接可以配置不同的预览内容和广告，也方便你追踪用户来源。
        </Paragraph>

        <Title level={5}>创建链接</Title>
        <Paragraph>
          <ol>
            <li>点击「新增链接」</li>
            <li>填写链接名称（方便辨认，比如"渠道A"、"测试链接"）</li>
            <li>填写链接代码（英文字母、数字，比如 channelA）</li>
            <li>点击确定</li>
          </ol>
        </Paragraph>
        <Paragraph>
          创建后，系统会生成一条完整的邀请链接，格式为：
        </Paragraph>
        <Paragraph code>
          https://t.me/你的机器人用户名?start=链接代码
        </Paragraph>
        <Paragraph>点击链接旁边的复制按钮可以一键复制，方便分发。</Paragraph>

        <Title level={5}>编辑和删除</Title>
        <Paragraph>
          <ul>
            <li>点击「编辑」可以修改名称或代码</li>
            <li>点击「删除」会移除该链接及其关联的内容和广告配置</li>
          </ul>
        </Paragraph>

        <Divider />

        {/* 4. 资源管理 */}
        <Title level={3} id="resources">4. 资源管理</Title>
        <Paragraph>
          <Text strong>位置：</Text> 左侧菜单 →「资源管理」
        </Paragraph>
        <Paragraph>
          资源是你要展示给用户的图片和视频素材。所有资源统一在这里上传和管理，之后再到「内容配置」和「广告配置」中引用它们。
        </Paragraph>

        <Title level={5}>资源分组</Title>
        <Paragraph>
          页面左侧是分组列表，你可以把资源按用途分类（比如"产品图"、"宣传视频"、"广告素材"等）。
        </Paragraph>
        <Paragraph>
          <ul>
            <li>点击「新增分组」创建新的分类</li>
            <li>点击分组名称可以筛选只看该分组下的资源</li>
            <li>点击「全部资源」查看所有资源</li>
          </ul>
        </Paragraph>

        <Title level={5}>上传资源</Title>
        <Paragraph>
          <ol>
            <li>点击右上角「上传资源」</li>
            <li>选择资源类型：
              <ul>
                <li><Text strong>图片</Text>：单张图片</li>
                <li><Text strong>视频</Text>：单个视频文件</li>
                <li><Text strong>图片组</Text>：多张图片打包成一组，用户会看到一个可以左右滑动的相册</li>
              </ul>
            </li>
            <li>选择所属分组（可选）</li>
            <li>填写说明文字（可选，会显示在图片或视频下方）</li>
            <li>选择文件并上传</li>
          </ol>
        </Paragraph>
        <Paragraph>
          上传视频后，系统会自动提取视频的时长、尺寸信息，并截取第一帧作为封面图，无需手动处理。
        </Paragraph>

        <Title level={5}>删除资源</Title>
        <Paragraph>
          每张资源卡片上有删除按钮，确认后会永久删除该资源文件。如果该资源已被内容或广告引用，删除后对应的配置也会失效，请注意检查。
        </Paragraph>

        <Divider />

        {/* 5. 内容配置 */}
        <Title level={3} id="contents">5. 内容配置</Title>
        <Paragraph>
          <Text strong>位置：</Text> 左侧菜单 →「内容配置」
        </Paragraph>
        <Paragraph>
          这里决定用户通过某条邀请链接进入机器人后，会看到哪些内容、以什么顺序展示。
        </Paragraph>

        <Title level={5}>配置步骤</Title>
        <Paragraph>
          <ol>
            <li>先在顶部选择一个机器人</li>
            <li>再选择该机器人下的一条邀请链接</li>
            <li>选择完成后，下方会显示当前已配置的内容列表</li>
          </ol>
        </Paragraph>

        <Title level={5}>添加内容</Title>
        <Paragraph>
          <ol>
            <li>点击「添加资源」按钮</li>
            <li>在弹出的窗口中，可以按分组筛选或搜索资源</li>
            <li>勾选你想要的资源，点击确认</li>
            <li>新添加的资源会出现在列表末尾</li>
          </ol>
        </Paragraph>

        <Title level={5}>调整顺序</Title>
        <Paragraph>
          内容列表支持拖拽排序。按住某一项上下拖动，松开即可改变展示顺序。用户看到的内容会按照这个顺序依次展示。
        </Paragraph>

        <Title level={5}>保存</Title>
        <Paragraph>
          调整完成后，务必点击「保存」按钮。不点保存的话，你的修改不会生效。
        </Paragraph>

        <Divider />

        {/* 6. 广告配置 */}
        <Title level={3} id="ads">6. 广告配置</Title>
        <Paragraph>
          <Text strong>位置：</Text> 左侧菜单 →「广告配置」
        </Paragraph>
        <Paragraph>
          广告会在用户浏览完内容后展示。配置方式和内容配置类似，但多了一个「按钮」功能。
        </Paragraph>

        <Title level={5}>配置步骤</Title>
        <Paragraph>
          <ol>
            <li>顶部选择机器人，再选择邀请链接（和内容配置一样）</li>
            <li>点击「添加资源」选择要作为广告展示的资源</li>
            <li>拖拽调整广告的展示顺序</li>
          </ol>
        </Paragraph>

        <Title level={5}>广告按钮</Title>
        <Paragraph>
          这是广告配置独有的功能。每条广告下方可以添加可点击的按钮，用户点击后会跳转到你指定的网址。
        </Paragraph>
        <Paragraph>
          <ol>
            <li>点击某条广告项，展开按钮编辑区域</li>
            <li>点击「添加按钮」</li>
            <li>填写按钮上显示的文字（比如"立即购买"、"了解详情"）</li>
            <li>填写点击后跳转的网址（必须是完整的网址，以 http:// 或 https:// 开头）</li>
            <li>可以添加多个按钮</li>
          </ol>
        </Paragraph>
        <Alert
          type="warning"
          showIcon
          message="按钮的网址必须是有效的完整网址。如果填写了无效的网址（比如少了 https://），广告将无法正常显示。"
          style={{ marginBottom: 16 }}
        />

        <Title level={5}>保存</Title>
        <Paragraph>
          同样，修改完成后必须点击「保存」才会生效。
        </Paragraph>

        <Divider />

        {/* 7. 用户列表 */}
        <Title level={3} id="users">7. 用户列表</Title>
        <Paragraph>
          <Text strong>位置：</Text> 左侧菜单 →「用户列表」
        </Paragraph>
        <Paragraph>
          这里可以查看所有通过机器人进入的用户记录，只能查看，不能修改或删除。
        </Paragraph>

        <Title level={5}>查看信息</Title>
        <Paragraph>
          每个用户会显示以下信息：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>Telegram ID：用户在 Telegram 上的唯一编号</li>
            <li>用户名：用户的 @用户名（如果有的话）</li>
            <li>姓名：用户设置的显示名称</li>
            <li>来源机器人：用户是通过哪个机器人进来的</li>
            <li>来源链接：用户点击的是哪条邀请链接</li>
            <li>首次访问时间</li>
            <li>最近访问时间</li>
          </ul>
        </Paragraph>

        <Title level={5}>筛选和搜索</Title>
        <Paragraph>
          <ul>
            <li>顶部搜索框可以按用户名或 ID 搜索</li>
            <li>可以按机器人筛选</li>
            <li>选择机器人后，还可以进一步按邀请链接筛选</li>
          </ul>
        </Paragraph>
        <Paragraph>
          这个功能主要用来了解用户来源分布，以及确认某条链接是否有人在使用。
        </Paragraph>

        <Divider />

        <Title level={3} id="stats">8. 统计报表</Title>
        <Paragraph>
          <Text strong>位置：</Text> 左侧菜单 →「统计报表」
        </Paragraph>
        <Paragraph>提供三个维度的数据概览。</Paragraph>

        <Title level={5}>今日概览</Title>
        <Paragraph>
          页面顶部的三张卡片，分别显示：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>今日新增用户数</li>
            <li>累计总用户数</li>
            <li>今日广告展示次数</li>
          </ul>
        </Paragraph>

        <Title level={5}>趋势图</Title>
        <Paragraph>
          <ul>
            <li>默认显示最近 7 天的数据</li>
            <li>可以通过日期选择器自定义查看范围</li>
            <li>鼠标悬停在柱子上可以看到当天的广告展示次数</li>
          </ul>
        </Paragraph>

        <Title level={5}>链接明细</Title>
        <Paragraph>
          底部表格按每条邀请链接分别统计，可以点击表头排序，方便找出效果最好的链接。
        </Paragraph>

        <Divider />

        <Title level={3} id="settings">9. 系统设置</Title>
        <Paragraph>
          <Text strong>位置：</Text> 左侧菜单 →「系统设置」
        </Paragraph>

        <Title level={5}>预览结束文案</Title>
        <Paragraph>
          用户看完所有内容后，机器人会发送一段结束语。在这里可以自定义这段文字的内容。
        </Paragraph>

        <Title level={5}>预览结束按钮</Title>
        <Paragraph>
          结束语下方可以附带可点击的按钮。每个按钮需要填写显示文字和跳转网址。比如设置一个"加入频道"的按钮，引导用户关注你的 Telegram 频道。
        </Paragraph>

        <Title level={5}>广告展示时长</Title>
        <Paragraph>
          控制每条广告停留多少秒后才出现「下一条」按钮，范围 1-60 秒。建议 5-10 秒比较合适。
        </Paragraph>

        <Title level={5}>保存</Title>
        <Paragraph>修改后点击「保存」按钮生效。</Paragraph>

        <Divider />

        <Title level={3} id="faq">10. 常见问题</Title>

        <Title level={5}>机器人没有响应？</Title>
        <Paragraph>
          <ul>
            <li>检查该机器人是否已启用（开关是否打开）</li>
            <li>检查 Token 是否正确（点击「验证」按钮确认）</li>
            <li>确认服务器上的机器人程序是否正常运行</li>
          </ul>
        </Paragraph>

        <Title level={5}>用户点击链接后没有内容？</Title>
        <Paragraph>
          <ul>
            <li>确认该邀请链接下已经配置了内容</li>
            <li>确认配置后点击了「保存」</li>
          </ul>
        </Paragraph>

        <Title level={5}>广告不显示？</Title>
        <Paragraph>
          <ul>
            <li>确认已配置广告</li>
            <li>检查按钮网址是否有效（必须以 http:// 或 https:// 开头）</li>
            <li>确认配置后点击了「保存」</li>
          </ul>
        </Paragraph>

        <Title level={5}>视频发送失败？</Title>
        <Paragraph>
          <ul>
            <li>单个视频文件不能超过 50MB</li>
            <li>确保上传的是常见视频格式（如 MP4）</li>
            <li>文件可能损坏，尝试重新上传</li>
          </ul>
        </Paragraph>

        <Title level={5}>图片组只显示了部分图片？</Title>
        <Paragraph>
          <ul>
            <li>Telegram 图片组最多支持 10 张，超出不会显示</li>
            <li>确保上传的都是图片，不要混入视频</li>
          </ul>
        </Paragraph>

        <Divider />

        <Paragraph type="secondary">
          如有其他问题，请联系技术人员协助处理。
        </Paragraph>
      </Typography>
    </div>
  );
}
