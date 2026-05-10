import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Space,
  Drawer,
  Form,
  Input,
  Select,
  message,
  Typography,
  Modal,
  List,
  Tag,
  Popconfirm,
  Row,
  Col,
  InputNumber,
  Spin,
  Card,
} from 'antd';
import {
  PlusOutlined,
  SaveOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  ImportOutlined,
  ExportOutlined,
  DeleteOutlined,
  CloseOutlined,
  CodeOutlined,
  ArrowRightOutlined,
  ForkOutlined,
  GatewayOutlined,
  PlaySquareOutlined,
  StopOutlined,
  UserOutlined,
  ApiOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import {
  getWorkflowDefinition,
  createWorkflowDefinition,
  updateWorkflowDefinition,
  validateWorkflowDefinition,
  testWorkflowDefinition,
} from '@/api';

const { Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

type NodeType =
  | 'start_event'
  | 'end_event'
  | 'user_task'
  | 'service_task'
  | 'exclusive_gateway'
  | 'parallel_gateway';

interface DesignerNode {
  id: string;
  type: NodeType;
  name?: string;
  x: number;
  y: number;
  next?: string;
  // user_task
  assignee?: string;
  candidateUsers?: string[];
  candidateGroups?: string[];
  dueDuration?: string;
  // service_task
  service?: string;
  config?: Record<string, unknown>;
  // exclusive_gateway
  conditions?: Array<{ name?: string; expression: string; next: string }>;
  // parallel_gateway
  mode?: 'split' | 'join';
  branches?: string[];
}

interface WorkflowDesignerState {
  key: string;
  name: string;
  nodes: DesignerNode[];
}

// ───────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────

const NODE_TYPES: { type: NodeType; label: string; icon: React.ReactNode; color: string }[] = [
  { type: 'start_event', label: '开始事件', icon: <PlaySquareOutlined />, color: '#52c41a' },
  { type: 'end_event', label: '结束事件', icon: <StopOutlined />, color: '#ff4d4f' },
  { type: 'user_task', label: '用户任务', icon: <UserOutlined />, color: '#1677ff' },
  { type: 'service_task', label: '服务任务', icon: <ApiOutlined />, color: '#722ed1' },
  { type: 'exclusive_gateway', label: '排他网关', icon: <ForkOutlined />, color: '#fa8c16' },
  { type: 'parallel_gateway', label: '并行网关', icon: <GatewayOutlined />, color: '#13c2c2' },
];

const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function generateId(prefix = 'node'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function toDesignerState(spec: any, key: string, name: string): WorkflowDesignerState {
  const nodes: DesignerNode[] = (spec.nodes ?? []).map((n: any, idx: number) => ({
    ...n,
    x: n.x ?? 100 + (idx % 4) * 200,
    y: n.y ?? 100 + Math.floor(idx / 4) * 120,
  }));
  return { key, name, nodes };
}

function fromDesignerState(state: WorkflowDesignerState): any {
  return {
    key: state.key,
    name: state.name,
    nodes: state.nodes.map((n) => {
      const { x, y, ...rest } = n;
      return rest;
    }),
  };
}

function getNodeConnections(nodes: DesignerNode[]): Array<{ from: string; to: string; label?: string }> {
  const connections: Array<{ from: string; to: string; label?: string }> = [];
  for (const node of nodes) {
    if (node.next) {
      connections.push({ from: node.id, to: node.next });
    }
    if (node.type === 'exclusive_gateway' && node.conditions) {
      for (const cond of node.conditions) {
        connections.push({ from: node.id, to: cond.next, label: cond.name || cond.expression });
      }
    }
    if (node.type === 'parallel_gateway' && node.mode === 'split' && node.branches) {
      for (const branchId of node.branches) {
        connections.push({ from: node.id, to: branchId, label: 'branch' });
      }
    }
  }
  return connections;
}

// ───────────────────────────────────────────────────────────────
// Components
// ───────────────────────────────────────────────────────────────

const WorkflowDesigner: React.FC = () => {
  const { key: paramKey } = useParams<{ key?: string }>();
  const navigate = useNavigate();

  // ── State ──
  const [loading, setLoading] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [state, setState] = useState<WorkflowDesignerState>({ key: '', name: '', nodes: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsKey, setSaveAsKey] = useState('');
  const [saveAsName, setSaveAsName] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedNode = useMemo(() => state.nodes.find((n) => n.id === selectedNodeId) ?? null, [state.nodes, selectedNodeId]);

  // ── New / Load based on route param ──
  const newWorkflow = () => {
    const key = `workflow_${Date.now()}`;
    setActiveKey(null);
    setState({
      key,
      name: '新建流程',
      nodes: [
        { id: 'start', type: 'start_event', name: '开始', x: 100, y: 100, next: 'end' },
        { id: 'end', type: 'end_event', name: '结束', x: 100, y: 300 },
      ],
    });
    setSelectedNodeId(null);
    setJsonMode(false);
  };

  const loadDefinition = async (key: string) => {
    setLoading(true);
    try {
      const res = await getWorkflowDefinition(key);
      if (res.success) {
        const def = res.data;
        setActiveKey(def.key);
        setState(toDesignerState(def.definition, def.key, def.name));
        setSelectedNodeId(null);
        setJsonMode(false);
      }
    } catch {
      message.error('加载流程定义失败');
    } finally {
      setLoading(false);
    }
  };

  // ── Load on mount if key provided ──
  useEffect(() => {
    if (paramKey) {
      loadDefinition(paramKey);
    } else {
      newWorkflow();
    }
  }, [paramKey]);

  // ── Node operations ──
  const addNode = (type: NodeType) => {
    const id = generateId(type);
    const newNode: DesignerNode = {
      id,
      type,
      name: NODE_TYPES.find((t) => t.type === type)?.label || id,
      x: 120 + Math.random() * 200,
      y: 120 + Math.random() * 200,
    };
    if (type === 'user_task') {
      newNode.assignee = '';
      newNode.candidateUsers = [];
      newNode.candidateGroups = [];
    }
    if (type === 'service_task') {
      newNode.service = 'echo';
      newNode.config = {};
    }
    if (type === 'exclusive_gateway') {
      newNode.conditions = [{ expression: 'default', next: '' }];
    }
    if (type === 'parallel_gateway') {
      newNode.mode = 'split';
      newNode.branches = [];
    }
    setState((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
    setSelectedNodeId(id);
  };

  const removeNode = (id: string) => {
    setState((prev) => {
      const filtered = prev.nodes.filter((n) => n.id !== id);
      // Clean up references
      const cleaned = filtered.map((n) => {
        const updated = { ...n };
        if (updated.next === id) delete updated.next;
        if (updated.conditions) {
          updated.conditions = updated.conditions.filter((c) => c.next !== id);
        }
        if (updated.branches) {
          updated.branches = updated.branches.filter((b) => b !== id);
        }
        return updated;
      });
      return { ...prev, nodes: cleaned };
    });
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const updateNode = (id: string, updates: Partial<DesignerNode>) => {
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    }));
  };

  const connectNodes = (fromId: string, toId: string) => {
    const fromNode = state.nodes.find((n) => n.id === fromId);
    if (!fromNode) return;
    if (fromNode.type === 'exclusive_gateway') {
      const conditions = [...(fromNode.conditions || [])];
      conditions.push({ expression: 'default', next: toId });
      updateNode(fromId, { conditions });
    } else if (fromNode.type === 'parallel_gateway' && fromNode.mode === 'split') {
      const branches = [...(fromNode.branches || [])];
      if (!branches.includes(toId)) branches.push(toId);
      updateNode(fromId, { branches });
    } else {
      updateNode(fromId, { next: toId });
    }
  };

  // ── Save ──
  const handleSave = async (asNew = false) => {
    const spec = fromDesignerState(state);
    try {
      if (asNew || !activeKey) {
        if (!saveAsKey || !saveAsName) {
          message.error('请输入流程标识和名称');
          return;
        }
        const payload = { name: saveAsName, key: saveAsKey, definition: { ...spec, key: saveAsKey, name: saveAsName } };
        await createWorkflowDefinition(payload);
        message.success('创建成功');
        setActiveKey(saveAsKey);
        setState((prev) => ({ ...prev, key: saveAsKey, name: saveAsName }));
        setSaveAsOpen(false);
        // refresh not needed in designer view
      } else {
        await updateWorkflowDefinition(activeKey, {
          name: state.name,
          definition: spec,
        });
        message.success('保存成功');
        // refresh not needed in designer view
      }
    } catch (e: any) {
      message.error(e.message || '请求失败');
    }
  };

  const openSaveAs = () => {
    setSaveAsKey(state.key + '_copy');
    setSaveAsName(state.name + ' (副本)');
    setSaveAsOpen(true);
  };

  // ── Validate ──
  const handleValidate = async () => {
    if (!activeKey) {
      message.info('请先保存流程定义');
      return;
    }
    try {
      const res = await validateWorkflowDefinition(activeKey);
      if (res.success) {
        if (res.data.valid) {
          message.success('验证通过');
        } else {
          Modal.error({
            title: '验证失败',
            content: (
              <List
                size="small"
                dataSource={res.data.errors}
                renderItem={(item: string) => <List.Item><Text type="danger">{item}</Text></List.Item>}
              />
            ),
          });
        }
      }
    } catch (e: any) {
      message.error(e.message || '验证失败');
    }
  };

  // ── Test ──
  const handleTest = async () => {
    if (!activeKey) {
      message.info('请先保存流程定义');
      return;
    }
    try {
      const res = await testWorkflowDefinition(activeKey);
      Modal.success({
        title: '测试运行成功',
        content: (
          <Space direction="vertical">
            <Text>实例 ID: {res.data.instance?.id}</Text>
            <Text>状态: {res.data.instance?.status}</Text>
            {res.data.task && <Text>当前任务: {res.data.task.nodeName || res.data.task.nodeId}</Text>}
          </Space>
        ),
      });
    } catch (e: any) {
      message.error(e.message || '测试运行失败');
    }
  };

  // ── Import / Export ──
  const handleExport = () => {
    const spec = fromDesignerState(state);
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.key || 'workflow'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const spec = JSON.parse(reader.result as string);
          if (!spec.key || !spec.name || !Array.isArray(spec.nodes)) {
            message.error('无效的流程定义文件');
            return;
          }
          setActiveKey(null);
          setState(toDesignerState(spec, spec.key, spec.name));
          setSelectedNodeId(null);
          message.success('导入成功');
        } catch {
          message.error('JSON 解析失败');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // ── JSON Editor ──
  const toggleJsonMode = () => {
    if (jsonMode) {
      // Apply JSON
      try {
        const spec = JSON.parse(jsonText);
        setState(toDesignerState(spec, spec.key || state.key, spec.name || state.name));
        setJsonMode(false);
        message.success('已应用 JSON');
      } catch {
        message.error('JSON 格式错误');
      }
    } else {
      setJsonText(JSON.stringify(fromDesignerState(state), null, 2));
      setJsonMode(true);
    }
  };

  // ── Connections ──
  const connections = useMemo(() => getNodeConnections(state.nodes), [state.nodes]);

  const [connectSource, setConnectSource] = useState<string | null>(null);

  const handleNodeClick = (id: string) => {
    if (connectSource) {
      if (connectSource !== id) {
        connectNodes(connectSource, id);
      }
      setConnectSource(null);
      return;
    }
    setSelectedNodeId(id);
  };

  // ── Render ──
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Left Sidebar: Palette only */}
      <div
        style={{
          width: 200,
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          background: '#fafafa',
        }}
      >
        <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
          <Text strong>节点面板</Text>
        </div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {NODE_TYPES.map((nt) => (
            <Button
              key={nt.type}
              size="small"
              icon={nt.icon}
              onClick={() => addNode(nt.type)}
              style={{ justifyContent: 'flex-start', borderColor: nt.color, color: nt.color }}
            >
              {nt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Toolbar */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#fff',
          }}
        >
          <Space>
            <Button icon={<RollbackOutlined />} onClick={() => navigate('/workflows')}>
              返回列表
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => navigate('/workflow/designer')}>
              新建流程
            </Button>
            <Button icon={<SaveOutlined />} type="primary" onClick={() => handleSave(false)}>
              保存
            </Button>
            <Button icon={<CopyOutlined />} onClick={openSaveAs}>
              另存为
            </Button>
            <Button icon={<CheckCircleOutlined />} onClick={handleValidate}>
              验证
            </Button>
            <Button icon={<PlayCircleOutlined />} onClick={handleTest}>
              测试运行
            </Button>
          </Space>
          <Space>
            <Button icon={<ImportOutlined />} onClick={handleImport}>
              导入
            </Button>
            <Button icon={<ExportOutlined />} onClick={handleExport}>
              导出
            </Button>
            <Button icon={<CodeOutlined />} onClick={toggleJsonMode}>
              {jsonMode ? '退出 JSON' : 'JSON'}
            </Button>
            {connectSource && (
              <Tag color="blue">
                连线模式: 选择目标节点
                <CloseOutlined style={{ marginLeft: 4, cursor: 'pointer' }} onClick={() => setConnectSource(null)} />
              </Tag>
            )}
          </Space>
        </div>

        {/* Name input */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
          <Input
            value={state.name}
            onChange={(e) => setState((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="流程名称"
            style={{ width: 300, fontWeight: 500 }}
            prefix={<Text type="secondary">{state.key}</Text>}
          />
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative', overflow: 'auto', background: '#f5f5f5' }}>
          {jsonMode ? (
            <TextArea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              style={{ width: '100%', height: '100%', fontFamily: 'monospace', fontSize: 13 }}
            />
          ) : (
            <div
              ref={canvasRef}
              style={{ width: 2000, height: 1200, position: 'relative' }}
              onClick={() => {
                setSelectedNodeId(null);
                setConnectSource(null);
              }}
            >
              {/* SVG Connections */}
              <svg
                style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              >
                {connections.map((conn, idx) => {
                  const fromNode = state.nodes.find((n) => n.id === conn.from);
                  const toNode = state.nodes.find((n) => n.id === conn.to);
                  if (!fromNode || !toNode) return null;
                  const x1 = fromNode.x + NODE_WIDTH / 2;
                  const y1 = fromNode.y + NODE_HEIGHT;
                  const x2 = toNode.x + NODE_WIDTH / 2;
                  const y2 = toNode.y;
                  return (
                    <g key={idx}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#999"
                        strokeWidth={2}
                        markerEnd="url(#arrowhead)"
                      />
                      {conn.label && (
                        <text
                          x={(x1 + x2) / 2}
                          y={(y1 + y2) / 2 - 4}
                          fill="#666"
                          fontSize={11}
                          textAnchor="middle"
                        >
                          {conn.label}
                        </text>
                      )}
                    </g>
                  );
                })}
                <defs>
                  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#999" />
                  </marker>
                </defs>
              </svg>

              {/* Nodes */}
              {state.nodes.map((node) => {
                const nt = NODE_TYPES.find((t) => t.type === node.type);
                const isSelected = selectedNodeId === node.id;
                return (
                  <div
                    key={node.id}
                    style={{
                      position: 'absolute',
                      left: node.x,
                      top: node.y,
                      width: NODE_WIDTH,
                      height: NODE_HEIGHT,
                      background: '#fff',
                      border: `2px solid ${isSelected ? '#1677ff' : nt?.color || '#d9d9d9'}`,
                      borderRadius: 8,
                      padding: 8,
                      cursor: 'pointer',
                      boxShadow: isSelected ? '0 0 0 2px rgba(22,119,255,0.2)' : '0 2px 4px rgba(0,0,0,0.06)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 2,
                      zIndex: isSelected ? 10 : 1,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNodeClick(node.id);
                    }}
                  >
                    <div style={{ color: nt?.color, fontSize: 16 }}>{nt?.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 500, textAlign: 'center', wordBreak: 'break-all' }}>
                      {node.name || node.id}
                    </div>
                    <Tag
                      style={{
                        position: 'absolute',
                        top: -10,
                        right: -8,
                        cursor: 'pointer',
                        fontSize: 10,
                        lineHeight: '16px',
                        padding: '0 4px',
                      }}
                      color="red"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNode(node.id);
                      }}
                    >
                      <DeleteOutlined />
                    </Tag>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Properties Drawer */}
      <Drawer
        title="节点属性"
        placement="right"
        width={380}
        open={!!selectedNode && !jsonMode}
        onClose={() => setSelectedNodeId(null)}
        mask={false}
      >
        {selectedNode && (
          <Form layout="vertical">
            <Form.Item label="节点 ID">
              <Input value={selectedNode.id} disabled />
            </Form.Item>
            <Form.Item label="节点名称">
              <Input
                value={selectedNode.name || ''}
                onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="类型">
              <Tag color={NODE_TYPES.find((t) => t.type === selectedNode.type)?.color}>
                {NODE_TYPES.find((t) => t.type === selectedNode.type)?.label}
              </Tag>
            </Form.Item>

            {/* Position */}
            <Row gutter={8}>
              <Col span={12}>
                <Form.Item label="X 坐标">
                  <InputNumber
                    value={selectedNode.x}
                    onChange={(v) => updateNode(selectedNode.id, { x: v || 0 })}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Y 坐标">
                  <InputNumber
                    value={selectedNode.y}
                    onChange={(v) => updateNode(selectedNode.id, { y: v || 0 })}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* Next connection */}
            {selectedNode.type !== 'end_event' && selectedNode.type !== 'exclusive_gateway' && selectedNode.type !== 'parallel_gateway' && (
              <Form.Item label="下一个节点">
                <Select
                  value={selectedNode.next || undefined}
                  onChange={(v) => updateNode(selectedNode.id, { next: v })}
                  allowClear
                  placeholder="选择下一个节点"
                >
                  {state.nodes
                    .filter((n) => n.id !== selectedNode.id)
                    .map((n) => (
                      <Option key={n.id} value={n.id}>
                        {n.name || n.id} ({NODE_TYPES.find((t) => t.type === n.type)?.label})
                      </Option>
                    ))}
                </Select>
              </Form.Item>
            )}

            {/* Connect button */}
            {selectedNode.type !== 'end_event' && (
              <Form.Item>
                <Button
                  block
                  icon={<ArrowRightOutlined />}
                  onClick={() => setConnectSource(selectedNode.id)}
                  type={connectSource === selectedNode.id ? 'primary' : 'default'}
                >
                  {connectSource === selectedNode.id ? '选择目标节点...' : '连线到...'}
                </Button>
              </Form.Item>
            )}

            {/* User Task Config */}
            {selectedNode.type === 'user_task' && (
              <>
                <Form.Item label="分配人">
                  <Input
                    value={selectedNode.assignee || ''}
                    onChange={(e) => updateNode(selectedNode.id, { assignee: e.target.value })}
                    placeholder="用户ID"
                  />
                </Form.Item>
                <Form.Item label="候选人 (逗号分隔)">
                  <Input
                    value={(selectedNode.candidateUsers || []).join(', ')}
                    onChange={(e) =>
                      updateNode(selectedNode.id, {
                        candidateUsers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="user1, user2"
                  />
                </Form.Item>
                <Form.Item label="候选组 (逗号分隔)">
                  <Input
                    value={(selectedNode.candidateGroups || []).join(', ')}
                    onChange={(e) =>
                      updateNode(selectedNode.id, {
                        candidateGroups: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="group1, group2"
                  />
                </Form.Item>
                <Form.Item label="超时时间 (ISO 8601)">
                  <Input
                    value={selectedNode.dueDuration || ''}
                    onChange={(e) => updateNode(selectedNode.id, { dueDuration: e.target.value })}
                    placeholder="PT2H"
                  />
                </Form.Item>
              </>
            )}

            {/* Service Task Config */}
            {selectedNode.type === 'service_task' && (
              <>
                <Form.Item label="服务名称">
                  <Select
                    value={selectedNode.service || 'echo'}
                    onChange={(v) => updateNode(selectedNode.id, { service: v })}
                  >
                    <Option value="echo">echo</Option>
                    <Option value="http_request">http_request</Option>
                  </Select>
                </Form.Item>
                <Form.Item label="配置 JSON">
                  <TextArea
                    rows={4}
                    value={JSON.stringify(selectedNode.config || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const config = JSON.parse(e.target.value);
                        updateNode(selectedNode.id, { config });
                      } catch {
                        // ignore invalid JSON while typing
                      }
                    }}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                </Form.Item>
              </>
            )}

            {/* Exclusive Gateway Config */}
            {selectedNode.type === 'exclusive_gateway' && (
              <>
                <Form.Item label="条件分支">
                  {(selectedNode.conditions || []).map((cond, idx) => (
                    <Card key={idx} size="small" style={{ marginBottom: 8 }}>
                      <Input
                        placeholder="名称"
                        value={cond.name || ''}
                        onChange={(e) => {
                          const conditions = [...(selectedNode.conditions || [])];
                          conditions[idx] = { ...cond, name: e.target.value };
                          updateNode(selectedNode.id, { conditions });
                        }}
                        style={{ marginBottom: 4 }}
                      />
                      <Input
                        placeholder="表达式"
                        value={cond.expression}
                        onChange={(e) => {
                          const conditions = [...(selectedNode.conditions || [])];
                          conditions[idx] = { ...cond, expression: e.target.value };
                          updateNode(selectedNode.id, { conditions });
                        }}
                        style={{ marginBottom: 4 }}
                      />
                      <Select
                        value={cond.next || undefined}
                        onChange={(v) => {
                          const conditions = [...(selectedNode.conditions || [])];
                          conditions[idx] = { ...cond, next: v };
                          updateNode(selectedNode.id, { conditions });
                        }}
                        allowClear
                        placeholder="目标节点"
                        style={{ width: '100%' }}
                      >
                        {state.nodes
                          .filter((n) => n.id !== selectedNode.id)
                          .map((n) => (
                            <Option key={n.id} value={n.id}>
                              {n.name || n.id}
                            </Option>
                          ))}
                      </Select>
                      <Button
                        size="small"
                        danger
                        style={{ marginTop: 4 }}
                        onClick={() => {
                          const conditions = [...(selectedNode.conditions || [])];
                          conditions.splice(idx, 1);
                          updateNode(selectedNode.id, { conditions });
                        }}
                      >
                        删除条件
                      </Button>
                    </Card>
                  ))}
                  <Button
                    size="small"
                    onClick={() => {
                      const conditions = [...(selectedNode.conditions || [])];
                      conditions.push({ expression: 'default', next: '' });
                      updateNode(selectedNode.id, { conditions });
                    }}
                  >
                    添加条件
                  </Button>
                </Form.Item>
              </>
            )}

            {/* Parallel Gateway Config */}
            {selectedNode.type === 'parallel_gateway' && (
              <>
                <Form.Item label="模式">
                  <Select
                    value={selectedNode.mode || 'split'}
                    onChange={(v) => updateNode(selectedNode.id, { mode: v })}
                  >
                    <Option value="split">分裂 (split)</Option>
                    <Option value="join">汇聚 (join)</Option>
                  </Select>
                </Form.Item>
                {selectedNode.mode === 'split' && (
                  <Form.Item label="分支节点">
                    <Select
                      mode="multiple"
                      value={selectedNode.branches || []}
                      onChange={(v) => updateNode(selectedNode.id, { branches: v })}
                      placeholder="选择分支节点"
                    >
                      {state.nodes
                        .filter((n) => n.id !== selectedNode.id)
                        .map((n) => (
                          <Option key={n.id} value={n.id}>
                            {n.name || n.id}
                          </Option>
                        ))}
                    </Select>
                  </Form.Item>
                )}
              </>
            )}

            {/* Delete node */}
            <Form.Item>
              <Popconfirm title="确定删除此节点？" onConfirm={() => removeNode(selectedNode.id)}>
                <Button danger block icon={<DeleteOutlined />}>
                  删除节点
                </Button>
              </Popconfirm>
            </Form.Item>
          </Form>
        )}
      </Drawer>

      {/* Save As Modal */}
      <Modal
        title="另存为"
        open={saveAsOpen}
        onOk={() => handleSave(true)}
        onCancel={() => setSaveAsOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="流程标识" required>
            <Input value={saveAsKey} onChange={(e) => setSaveAsKey(e.target.value)} placeholder="如: leave-request" />
          </Form.Item>
          <Form.Item label="流程名称" required>
            <Input value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)} placeholder="如: 请假申请" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default WorkflowDesigner;
