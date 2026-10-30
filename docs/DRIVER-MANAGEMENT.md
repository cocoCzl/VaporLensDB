# 数据库产品、驱动与安装管理

产品表示数据库身份，驱动定义表示实现方式，安装表示一组固定版本的 JDBC 文件。
每条连接独立选择驱动；当前支持与未验证限制统一见 [SUPPORT（英文）](SUPPORT.md)。

## 添加产品与连接

1. 在新建连接目录点击「添加自定义数据库」，或打开「设置 → 数据库与驱动」点击同名按钮。
   表单立即进入基本信息，填写产品名、驱动名和 JDBC 类名；驱动文件与高级配置分别位于对应标签页。
2. 选择完整 JDBC URL、主机与端口或文件路径连接方式，按厂商要求设置必填参数。
   未知方言保留“未知／通用 SQL”。已有产品添加 JDBC 实现时，直接选择该产品，或复制内置 JDBC 定义。
3. 「保存并使用」直接进入该产品的连接参数页；「保存」进入管理页。产品立即出现在连接目录，无需重启。
   产品 ID 与名称分离，重命名不改变引用。为已有产品新增或复制驱动定义不会创建新产品。
4. 输入版本标签，依次导入主驱动 JAR 和依赖。首个文件是主驱动，每次导入创建新的不可变安装；
   不要将多个主驱动版本拼进同一 classpath。版本标签由用户填写；另行记录主 JAR Manifest 的版本，没有可读版本时明确标记未验证。Manifest 版本不是发布者认证。
5. 按需点击「检查 Java」及「加载驱动类」，分别检查运行时、bridge、类及依赖加载。记录中的运行时/安装指纹只证明当时的类加载结果，
   不代表连接或厂商功能已验证。运行要求见 [INSTALL（英文）](INSTALL.md#requirements)。
6. 新建连接先在可搜索、筛选和滚动的目录选择产品，再进入参数页选择定义和安装版本。
   “更换数据库”保留各产品独立草稿；管理、下载和本地导入在同一面板内切换；「返回」恢复来源页与草稿，
   「取消」退出任务，未保存修改需选择继续编辑或放弃。已有连接直接进入参数页。
   缺少安装可下载、导入或先仅保存；取消或失败不会丢弃草稿。

有成熟原生实现的产品默认推荐 Native Rust，仅有 JDBC 的产品默认 JDBC。
Java 缺失不影响原生连接。失效引用会要求修复，不会自动回退另一后端或重放失败 SQL。

## 下载推荐 JDBC 安装

Native Rust 实现随应用提供，不下载 Rust 驱动。内置 PostgreSQL、MySQL、SQLite 和 SQL Server 的 JDBC 定义
可下载固定推荐版本，也支持本地 JAR。自定义产品先使用本地导入；Oracle 等未提供经核对下载清单的产品保留官网入口，
不根据相近协议推断兼容性。openGauss 与不同 GaussDB 产品不能视作同一适配。

在“数据库与驱动”或连接参数页点击“下载推荐版本”，先查看版本、HTTPS 来源、完整文件清单、许可和适用范围，
再确认下载。版本与摘要由随应用发布的固定清单维护，不会运行时解析任意 Maven 依赖或寻找最新版。
下载任务显示字节进度，可取消、重试；全部依赖符合预先固定的 SHA-256 后才发布为新安装。
错误、缺失依赖和取消不产生半成品安装。关闭表单可从任务列表跟踪；完成后不会绑定到其他产品或已关闭的表单。

文件指纹验证的是固定文件内容，不等于发布者签名认证。清单逐文件保留摘要来源；部分依赖的 SHA-256 来自人工核对的
HTTPS 文件并与 Central 发布的 SHA-1 交叉检查，不宣称独立签名认证。下载记录保存版本、来源与指纹；
本地导入仅记录本地来源、Manifest 版本及文件指纹，不声称文件来自官网。

“文件已安装”“Java 21+ 可用”“驱动类加载成功”和“数据库连接成功”是独立状态。
下载不执行 Java 探测或数据库连接；可以按需检查 Java、加载驱动类，再测试实际连接。
SQL Server 推荐下载仅含 SQL 认证依赖；Azure、集成认证、Always Encrypted 不在该清单的完整支持范围内。
MySQL 云认证和 PostgreSQL Windows 集成认证的可选依赖也未包含。

## 安装版本与删除保护

JDBC 连接固定 `driverInstallationId`。导入新安装后，旧连接仍使用原安装；
只有明确编辑该连接并选择新版本才会升级。更换前可先用独立测试连接验证。

管理器显示安装的连接引用。被连接引用的定义、安装或 JAR 不能直接删除；
定义拥有安装或仍为产品默认时也不能删除。被引用定义的类、URL 模板、模式、方言、默认端口、
元数据 SQL 和能力等执行字段不能原地修改，显示名可改。先通过连接编辑流程迁移引用，
并处理未提交事务和活动会话。新安装发布失败保留旧安装，清理本次暂存文件；
安装删除不会物理移除迁移保留的外部原始 JAR。

## 配置迁移

配置 schema 13 在 SQLite 事务内迁移旧数据，失败回滚，可重试；migration 1–12 保持原行为。

- 原生与已知 JDBC 定义保留原 ID、后端及产品关系。具名自定义定义映射到
  `custom-product:<definition-id>`，不会因方言相同合并产品。
- 旧连接保留 UUID、密码引用、SSH、分组、历史及草稿。连接自己的有序 JAR 集合固定为安装，
  独立类名覆盖生成 `legacy-connection:<UUID>` 派生定义。
- 迁移保留旧 JAR 路径，不搬动厂商文件；新导入才进入受管安装目录。
- 显式缺失引用保留原始数据并提示修复。内置 seed 不覆盖已存定义的后端、类、模板、默认参数和有序文件等执行字段，
  仅刷新内置能力说明。现代连接缺少安装时不会自动绑定新默认。

## 备份恢复与跨机器导入

升级前完全退出应用，备份完整配置目录及外部 JAR，并保留平台凭据存储。
配置库位置见 [INSTALL（英文）](INSTALL.md#credentials-and-configuration)。
如需在线快照，使用 SQLite backup API，例如 Python `sqlite3.Connection.backup()`；
存在 WAL 时仅复制主 `config.db` 不是一致性备份。敏感 Properties 和凭据引用仍依赖相应密钥或系统凭据。

不保证旧程序可读取 schema 13。降级时停止新程序，恢复升级前完整备份并使用匹配版本；
不要让旧程序直接打开新 schema，也不要只回退数据库而忽略 JAR 和凭据。
首次升级可先在隔离副本验证，注意 [WebView 与凭据的隔离限制（英文）](TESTING.md#application-profiles)。

配置描述导出包含 schemaVersion、产品、定义、安装描述、分组与连接，
不含密码、敏感属性值、本机校验记录或厂商二进制。导入是原子追加；连接 UUID 冲突会拒绝，
不会覆盖活动连接。跨机器导入后重定位 JAR、校验 Java 并重新输入凭据。
旧 connections-only 格式及 DBeaver 导入仍可使用；未识别产品需显式映射或跳过，不自动认定厂商兼容。

## URL、Properties 与网络

- `hostPort` 根据 host、port、database 等结构化值生成 URL；原始 URL 模式以输入 URL 为准；
  file 模式使用文件路径或文件 URI。URL 模板仅替换 `{host}`、`{port}`、`{database}`、`{username}`、`{file}`，不执行脚本。
  内置 Oracle 定义区分 Service 与 SID，SID 的实库验证状态见支持说明。
- 同一产品切换驱动保留显式主机、端口、用户名和数据库，即使端口等于旧默认值也保留。
  驱动类、安装和专用 Properties 随定义切换。
- Properties 默认敏感，使用现有凭据存储加密，经 stdin 传给 bridge，不进入 Java 命令行。
  取消“敏感”允许普通配置导出该值，只适用于非敏感参数。不要把凭据直接写入 URL 或元数据 SQL。
- JDBC 没有通用的独立 TLS 选项映射。旧配置中无法映射的独立 TLS 要求会报错，不能清空安全要求来绕过；
  按厂商文档用 URL/Properties 配置并验证实际连接。
- 结构化 JDBC + SSH 先建立隧道，再以转发端点生成 URL。不能可靠重写的原始 URL 明确拒绝。
  SSH 与任意 JDBC Properties 同时启用会在开隧道前拒绝，防止 host/socket/factory 参数绕过转发；不会静默移除 SSH。
- SQLite 文件、`:memory:` 和文件 URI 分别解析。测试新文件使用临时探针，不创建指定目标；
  已保存连接的文件丢失时重连报错，不悄悄新建。内存库随物理会话关闭消失；
  命名 shared-cache URI 也不能跨独立 bridge JVM 共享数据。

## 元数据 SQL

通常先留空，使用 JDBC `DatabaseMetaData`。只有目录浏览需要厂商 SQL 时才覆盖个别操作。
该字段为严格 JSON 对象，键采用下表大小写，值为单条只读 SQL 字符串；不支持注释或脚本。
SQL 方言与产品适配器相互独立：选择 Oracle 方言不会自动获得 Oracle 系统目录或 Explain 能力。
未知方言仍可执行用户 SQL，但不猜测自动分页或导入 SQL。

### 操作与逐操作回退

| JSON 键 | 可用占位符 | 未配置该键时 |
| --- | --- | --- |
| `databases` | 无 | JDBC 目录 |
| `schemas` | `{database}` | JDBC schema |
| `tables`, `views` | `{schema}` | JDBC 表/视图 |
| `columns`, `indexes`, `foreignKeys` | `{schema}`, `{table}` | 对应 JDBC 元数据 |
| `functions` | `{schema}` | 不支持，需模板 |
| `schemaObjects` | `{schema}`, `{kind}` | 不支持，需模板 |
| `tableDdl` | `{schema}`, `{table}` | 不支持，需模板 |
| `objectDdl` | `{schema}`, `{name}`, `{kind}` | 不支持，需模板 |

每个操作独立选择模板或回退：配置了模板但执行失败时会报告错误，不再回退成空结果。
可见对象仍受驱动、权限和定义能力约束；高级对象及 Explain 不因基础目录可用而自动开放。

占位符表示 SQL 字符串字面量的内容，单引号会转义。应写为 `WHERE table_schema = '{schema}'`，
不能用它拼接未经验证的标识符或 SQL 片段。`database` 是树中选中的目录，`schema` 是 schema
（MySQL 为数据库），`table` 是表/视图名，`name` 是对象名；`kind` 可为
`table`、`view`、`function`、`procedure`、`sequence`、`trigger`、`event`、`package` 等。
只有表中该操作列出的占位符会被替换。

### 结果字段契约

使用以下标准别名，字段名匹配不区分大小写。完整返回这些字段可避免缺省值带来的信息损失：

| 操作 | 标准字段 | 可选字段 |
| --- | --- | --- |
| `databases` | `name` | 也接受 `database`、`database_name` 作为名称 |
| `schemas` | `name` | `database_name`（也接受 `database`） |
| `tables`, `views` | `schema_name`, `name`, `table_type` | `row_count` |
| `columns` | `schema_name`, `table_name`, `name`, `ordinal_position`, `data_type` | `nullable`, `default_value`, `character_maximum_length`, `numeric_precision`, `numeric_scale`, `is_primary_key`, `is_generated`, `is_auto_increment` |
| `indexes` | `schema_name`, `table_name`, `name` | `column_names`, `is_unique`, `definition` |
| `foreignKeys` | `schema_name`, `table_name`, `name`, `referenced_table` | `column_names`, `referenced_schema`, `referenced_columns` |
| `functions` | `name` | 也接受 `function`、`function_name` |
| `schemaObjects` | `schema_name`, `name`, `kind` | `object_type`, `status` |
| `tableDdl` | `ddl` | 也接受 `definition`，不接受 `source` |
| `objectDdl` | `ddl` | 也接受 `definition`、`source` |

名称缺失的对象行会被略过，外键还需 `referenced_table`；缺失 schema/table 可从请求补全，
表类型和对象种类可从操作补全。列序号缺省按返回顺序、类型为 `unknown`、可空为 true，
主键/生成列/自增标记为 false；模板应明确返回这些值，不应依赖缺省来表示厂商特性。
索引和外键的列名列表使用逗号分隔字符串；布尔值接受布尔、数值 `1`/`0`、
字符串 `true`/`false`、`yes`/`no`（也接受 `y`/`n`）。避免 `schema`、`columns`、`unique`
等易歧义或保留字别名，优先用表中的名称。DDL 操作取首行，缺少可识别 DDL 字段时报错。

最小示例：只覆盖 PostgreSQL 列信息，其他基础操作继续使用 JDBC 元数据。

```json
{
  "columns": "SELECT table_schema AS schema_name, table_name, column_name AS name, ordinal_position, data_type, (is_nullable = 'YES') AS nullable, column_default AS default_value FROM information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{table}' ORDER BY ordinal_position"
}
```

内置厂商 SQL 统一维护在 [driver_catalog.rs](../src-tauri/src/services/driver_catalog.rs)，不在文档复制。
Oracle 使用 `ALL_*` 可见范围，`DBMS_METADATA.GET_DDL` 可能需要额外权限；
MySQL `SHOW CREATE` 的 `Create Table` 列不符合上述 DDL 别名，需适配；PostgreSQL 定义也受权限限制。
发布自定义模板前，分别验证连接、用户查询、对象树、列、索引、外键及错误呈现。
取消、事务和大结果抓取限制见 [SUPPORT（英文）](SUPPORT.md#jdbc-and-network-limits)。
