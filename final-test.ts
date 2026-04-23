// 最终测试 - 检查 /api/users 是否返回角色信息
import * as http from 'http';

function request(options: http.RequestOptions, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve({ status: res.statusCode, data: result });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test() {
  console.log('=== 最终测试开始 ===');

  // 登录
  console.log('\n步骤1: 登录获取 token');
  const loginRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  }, { username: 'admin', password: 'admin123' });

  console.log('登录状态:', loginRes.status);
  if (!loginRes.data?.success) {
    console.log('登录失败:', loginRes);
    return;
  }
  console.log('✓ 登录成功');
  const token = loginRes.data.token;

  // 获取用户列表
  console.log('\n步骤2: 调用 /api/users 获取用户列表');
  const usersRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });

  console.log('用户列表状态:', usersRes.status);
  if (!usersRes.data?.success) {
    console.log('获取失败:', usersRes);
    return;
  }

  // 检查角色信息
  console.log('\n步骤3: 检查用户角色信息');
  const users = usersRes.data.users || [];
  let hasRoles = false;
  let hasAnyRolesField = false;

  for (const user of users) {
    if (user.roles) {
      hasAnyRolesField = true;
      if (user.roles.length > 0) {
        hasRoles = true;
        console.log(`✓ 用户 ${user.username} 有角色:`, user.roles);
      }
    } else {
      console.log(`✗ 用户 ${user.username} 没有 roles 字段`);
    }
  }

  console.log('\n=== 最终结果 ===');
  console.log('✓ 有用户:', users.length > 0);
  console.log('✓ 有 roles 字段:', hasAnyRolesField);
  console.log('✓ 有角色信息:', hasRoles);
  console.log('✓ 成功:', users.length > 0 && hasAnyRolesField && hasRoles);

  console.log('\n=== 完整响应 ===');
  console.log(JSON.stringify(usersRes.data, null, 2));
}

setTimeout(test, 4000);
