import { Typography, Divider, Alert } from 'antd';

const { Title, Paragraph, Text } = Typography;

export default function SmartQuestion() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <Typography>
        <Title level={2}>提问的智慧</Title>
        <Paragraph type="secondary">
          本文改编自 Eric S. Raymond 的
          <a href="http://www.catb.org/~esr/faqs/smart-questions.html" target="_blank" rel="noopener noreferrer">
            《How To Ask Questions The Smart Way》
          </a>
          ，针对本项目的使用场景做了精简和调整。
        </Paragraph>

        <Alert
          type="info"
          showIcon
          message="核心原则"
          description="提问的核心就三件事：说清楚你做了什么、发生了什么、你期望什么。做到这三点，大多数问题都能得到快速有效的回答。尊重别人的时间，别人也会尊重你的问题。"
          style={{ marginBottom: 24 }}
        />

        <Divider />

        <Title level={4}>目录</Title>
        <Paragraph>
          <ol>
            <li><a href="#before">提问之前</a></li>
            <li><a href="#how">怎样提问</a></li>
            <li><a href="#title">写一个好标题</a></li>
            <li><a href="#describe">描述问题</a></li>
            <li><a href="#code">关于代码和截图</a></li>
            <li><a href="#donts">不要做的事</a></li>
            <li><a href="#after">得到回答之后</a></li>
            <li><a href="#noresponse">如果没人回答</a></li>
            <li><a href="#examples">好问题与坏问题</a></li>
          </ol>
        </Paragraph>

        <Divider />

        <Title level={3} id="before">1. 提问之前</Title>
        <Paragraph>
          在你开口问别人之前，请先自己试试以下几件事：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>用搜索引擎搜一下你遇到的错误信息或关键词</li>
            <li>翻一翻相关的文档、帮助页面或常见问题（FAQ）</li>
            <li>看看有没有人问过类似的问题（论坛、群组、Issue 列表等）</li>
            <li>自己动手试验一下，排除一些可能性</li>
            <li>问问身边懂行的朋友</li>
          </ul>
        </Paragraph>
        <Paragraph>
          提问时如果能说一句"我搜过了，试过了某某方法但没有解决"，会让回答者知道你不是伸手党，也能帮他们更快定位问题。
        </Paragraph>
        <Paragraph>
          别指望搜索几秒钟就能解决问题。花点时间认真查找和思考，你越是表现出做过功课，越容易得到认真的回答。
        </Paragraph>

        <Divider />

        <Title level={3} id="how">2. 怎样提问</Title>

        <Title level={5}>找对地方</Title>
        <Paragraph>
          在哪里提问很重要。把问题发到不相关的地方，大概率会被忽略。确保你的问题和所在的群组、频道或论坛的主题相关。
        </Paragraph>

        <Title level={5}>把问题说清楚</Title>
        <Paragraph>
          好的提问应该包含以下信息：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>你想做什么（目标）</li>
            <li>你做了什么（已经尝试过的步骤）</li>
            <li>发生了什么（实际结果，包括错误信息）</li>
            <li>你期望发生什么（预期结果）</li>
            <li>相关的环境信息（系统版本、软件版本等）</li>
          </ul>
        </Paragraph>

        <Title level={5}>用词清晰，排版整洁</Title>
        <Paragraph>
          写得乱七八糟的问题，别人看着也头疼。不需要多正式，但至少做到：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>分段落，别把所有内容挤成一坨</li>
            <li>错误信息、日志、代码用代码块格式贴出来，别直接糊上去</li>
            <li>不要全部大写，也不要满屏感叹号</li>
            <li>检查一下有没有明显的错别字</li>
          </ul>
        </Paragraph>

        <Divider />

        <Title level={3} id="title">3. 写一个好标题</Title>
        <Paragraph>
          标题是别人决定要不要点进来看的第一印象。一个好标题应该简短地概括问题的核心。
        </Paragraph>

        <Paragraph>
          <Text type="danger">差的标题：</Text>
        </Paragraph>
        <Paragraph>
          <ul>
            <li>"救命啊！！！"</li>
            <li>"出问题了"</li>
            <li>"大佬帮忙看看"</li>
          </ul>
        </Paragraph>

        <Paragraph>
          <Text type="success">好的标题：</Text>
        </Paragraph>
        <Paragraph>
          <ul>
            <li>"上传视频后机器人发送失败，提示文件过大"</li>
            <li>"配置广告按钮后点击无反应，URL 格式是否有要求？"</li>
            <li>"邀请链接生成成功但用户点击后没有内容展示"</li>
          </ul>
        </Paragraph>
        <Paragraph>
          好标题的模式通常是：<Text code>在什么情况下 + 出了什么问题</Text>。这样别人一眼就知道你遇到了什么，也方便后来的人搜索到类似问题。
        </Paragraph>

        <Divider />

        <Title level={3} id="describe">4. 描述问题</Title>

        <Title level={5}>说症状，不要说猜测</Title>
        <Paragraph>
          告诉别人你看到了什么现象，而不是你觉得原因是什么。你的猜测可能是错的，反而会把帮你的人带偏。
        </Paragraph>
        <Paragraph>
          <Text type="danger">不好：</Text>"我觉得是数据库挂了，怎么修？"
        </Paragraph>
        <Paragraph>
          <Text type="success">好：</Text>"点击保存后页面提示 500 错误，后台日志显示 connection refused，数据库服务好像没启动。"
        </Paragraph>

        <Title level={5}>说目标，不要只说步骤</Title>
        <Paragraph>
          有时候你卡在某个步骤上，但其实换个方法就能达到目的。如果你只描述步骤不说目标，别人没法给你更好的建议。
        </Paragraph>
        <Paragraph>
          <Text type="danger">不好：</Text>"怎么把这个 JSON 字段改成数组？"
        </Paragraph>
        <Paragraph>
          <Text type="success">好：</Text>"我想让一条广告下面显示多个按钮，目前数据结构只支持一个，应该怎么调整？"
        </Paragraph>

        <Title level={5}>按时间顺序描述</Title>
        <Paragraph>
          如果问题涉及一系列操作，按照事情发生的先后顺序来描述。先做了什么，再做了什么，然后出了什么问题。这样别人更容易跟上你的思路。
        </Paragraph>

        <Divider />

        <Title level={3} id="code">5. 关于代码和截图</Title>
        <Paragraph>
          如果问题和代码有关：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>贴出相关的代码片段，不要贴几百行让别人自己找</li>
            <li>尽量缩小范围，找到能重现问题的最少代码</li>
            <li>贴完整的错误信息，不要只说"报错了"</li>
          </ul>
        </Paragraph>
        <Paragraph>
          如果问题和界面有关：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>截图时标注出问题所在的位置</li>
            <li>说明你期望看到什么，实际看到了什么</li>
            <li>如果有浏览器控制台报错，一并截图</li>
          </ul>
        </Paragraph>

        <Divider />

        <Title level={3} id="donts">6. 不要做的事</Title>

        <Alert
          type="warning"
          showIcon
          message="以下行为会大大降低你得到帮助的概率"
          style={{ marginBottom: 16 }}
        />

        <Paragraph>
          <ul>
            <li>
              <Text strong>不要只说"不好用了"。</Text>
              {' '}什么不好用？怎么操作的？报了什么错？没有细节，谁也帮不了你。
            </li>
            <li>
              <Text strong>不要标记"紧急"。</Text>
              {' '}你的紧急是你的事，这种标记只会让人反感。越是标紧急，越没人想理。
            </li>
            <li>
              <Text strong>不要卑微地求人。</Text>
              {' '}"我是小白什么都不懂求大佬帮忙"这种话没有任何帮助。把精力花在描述问题上，比花在自我贬低上有用得多。
            </li>
            <li>
              <Text strong>不要同时在很多地方问同一个问题。</Text>
              {' '}选一个最合适的地方问就好。到处撒网只会让人觉得你在浪费大家的时间。
            </li>
            <li>
              <Text strong>不要一上来就说是 Bug。</Text>
              {' '}除非你有充分的证据，否则先假设是自己哪里搞错了。如果真是 Bug，描述清楚现象，维护者自然会判断。
            </li>
            <li>
              <Text strong>不要要求私聊回答。</Text>
              {' '}公开提问、公开回答，这样其他遇到同样问题的人也能受益。
            </li>
          </ul>
        </Paragraph>

        <Divider />

        <Title level={3} id="after">7. 得到回答之后</Title>

        <Title level={5}>别急着反驳</Title>
        <Paragraph>
          如果回答不是你想要的，先想想对方说的有没有道理。也许你的问题本身就有偏差，对方是在纠正你的方向。
        </Paragraph>

        <Title level={5}>看不懂就再查查</Title>
        <Paragraph>
          如果回答中有你不理解的内容，先自己搜索一下再追问。追问时说清楚"你说的某某我查了一下，理解是这样的，但某某部分还是不太明白"，比直接说"看不懂，能再说一遍吗"好得多。
        </Paragraph>

        <Title level={5}>问题解决了记得说一声</Title>
        <Paragraph>
          这一点很多人忽略了，但非常重要。问题解决后，回来说一下是怎么解决的：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>帮助过你的人会有成就感，下次更愿意帮忙</li>
            <li>后来遇到同样问题的人可以直接参考你的解决方案</li>
            <li>一句"搞定了，原因是某某，改了某某就好了，谢谢大家"就够了</li>
          </ul>
        </Paragraph>

        <Title level={5}>别玻璃心</Title>
        <Paragraph>
          有时候回答的语气可能不太客气，这在技术社区很常见。对方可能只是习惯了直来直去，并不是针对你。关注内容本身，别纠结语气。如果对方确实在人身攻击，忽略就好，不要卷入骂战。
        </Paragraph>

        <Divider />

        <Title level={3} id="noresponse">8. 如果没人回答</Title>
        <Paragraph>
          没人回答不代表别人故意无视你，可能的原因有：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>你的问题描述不够清楚，别人看不懂</li>
            <li>恰好没有人知道答案</li>
            <li>问题被淹没在其他消息里了</li>
          </ul>
        </Paragraph>
        <Paragraph>
          你可以：
        </Paragraph>
        <Paragraph>
          <ul>
            <li>重新组织一下问题的描述，补充更多细节后再发一次</li>
            <li>换一个更合适的地方提问</li>
            <li>不要短时间内反复发同一个问题，这只会让人反感</li>
          </ul>
        </Paragraph>

        <Divider />

        <Title level={3} id="examples">9. 好问题与坏问题</Title>

        <Paragraph>
          <Text type="danger">坏：</Text>"机器人不好用了，怎么办？"
        </Paragraph>
        <Paragraph type="secondary">
          什么叫不好用？哪个机器人？什么操作？什么现象？这种问题没人能回答。
        </Paragraph>

        <Paragraph>
          <Text type="success">好：</Text>"我在后台给机器人 @xxx_bot 配置了 3 条内容和 1 条广告，用户点击邀请链接后能看到内容，但广告没有显示。后台日志没有报错，广告配置页面显示已保存。"
        </Paragraph>
        <Paragraph type="secondary">
          环境清楚，操作清楚，现象清楚，排查过的也说了。这种问题很容易得到帮助。
        </Paragraph>

        <Divider />

        <Paragraph>
          <Text type="danger">坏：</Text>"视频发不出去，是不是有 Bug？"
        </Paragraph>
        <Paragraph type="secondary">
          什么视频？多大？什么格式？报了什么错？凭什么说是 Bug？
        </Paragraph>

        <Paragraph>
          <Text type="success">好：</Text>"我上传了一个 120MB 的 MP4 视频作为资源，在后台上传成功了，但用户在 Telegram 收到的消息是'资源加载失败'。我看到文档说视频不能超过 50MB，是不是这个原因？"
        </Paragraph>
        <Paragraph type="secondary">
          自己已经查过文档并给出了合理猜测，回答者只需要确认或纠正就行。
        </Paragraph>

        <Divider />

        <Paragraph>
          <Text type="danger">坏：</Text>"帮我看看代码哪里有问题"（然后贴了 500 行）
        </Paragraph>
        <Paragraph type="secondary">
          没人有义务帮你从 500 行代码里大海捞针。
        </Paragraph>

        <Paragraph>
          <Text type="success">好：</Text>"这个函数在第 15 行调用后返回了 undefined，我预期它应该返回一个数组。我检查了传入的参数是正确的，怀疑是第 8 行的条件判断有问题。"
        </Paragraph>
        <Paragraph type="secondary">
          范围明确，有自己的分析，别人一看就知道从哪里入手。
        </Paragraph>

        <Divider />

      </Typography>
    </div>
  );
}
