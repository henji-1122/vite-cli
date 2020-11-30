#!/usr/bin/env node

const path = require('path')
const { Readable } = require('stream') // node的stream中的Readable模块
const Koa = require('koa')
const send = require('koa-send')
const compilerSFC = require('@vue/compiler-sfc') // 编译单文件组件

const app = new Koa()

// 流--->字符串
const streamToString = stream => new Promise((resolve, reject) => { // 读取流是异步过程，返回Promise
  const chunks = [] // 存储读取到的Buffer
  stream.on('data', chunk => chunks.push(chunk)) // 监听读取Buffer，存储到chunks中
  stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8'))) // 将chunks中的Buffer合并，再转换成字符串
  stream.on('error', reject)
})

// 字符串--->流
const stringToStream = text => {
  const stream = new Readable()
  stream.push(text) // 将字符串写入到stream中
  stream.push(null) // 标识流已写完
  return stream
}

// 3. 加载第三方模块
app.use(async (ctx, next) => {
  // ctx.path --> /@modules/vue
  if (ctx.path.startsWith('/@modules/')) {
    const moduleName = ctx.path.substr(10)
    const pkgPath = path.join(process.cwd(), 'node_modules', moduleName, 'package.json') //process.cwd()当前项目所在路径
    const pkg = require(pkgPath)
    ctx.path = path.join('/node_modules', moduleName, pkg.module) // 拼接路径
  }
  await next()
})

// 1. 静态文件服务器
app.use(async (ctx, next) => { // 中间件
  await send(ctx, ctx.path, { root: process.cwd(), index: 'index.html' }) // 调用send将index.html(根目录下的，当前运行这个node程序的目录)返回给浏览器
  await next() // 执行下一个中间件
})

// 4. 处理单文件组件
app.use(async (ctx, next) => {
  if (ctx.path.endsWith('.vue')) { // 判断请求的路径是否为单文件组件
    const contents = await streamToString(ctx.body) 
    const { descriptor } = compilerSFC.parse(contents) // compilerSFC.parse()编译单文件组件，返回一个对象：单文件组件的描述对象|errors编译过程中的错误
    let code // 最终要返还给浏览器的代码
    if (!ctx.query.type) { // 第一次请求不带参数
      code = descriptor.script.content
      // console.log(code)
      code = code.replace(/export\s+default\s+/g, 'const __script = ')
      code += `
      import { render as __render } from "${ctx.path}?type=template"
      __script.render = __render
      export default __script
      `
    } else if (ctx.query.type === 'template') { // 第二次请求单文件组件
      const templateRender = compilerSFC.compileTemplate({ source: descriptor.template.content }) // 编辑模板
      code = templateRender.code // templateRender.code就是runder函数
    }
    ctx.type = 'application/javascript' // 响应头中的contentType
    ctx.body = stringToStream(code) // 将code输出给浏览器，需要将字符串转换成流
  }
  await next()
})

// 2. 修改第三方模块的路径
app.use(async (ctx, next) => {
  if (ctx.type === 'application/javascript') { // 判断返还给浏览器的是否为javascript模块
    const contents = await streamToString(ctx.body) // 读取到的内容转换成字符串
    // import vue from 'vue' 第三方模块
    // import App from './App.vue'  本地模块 这种能正常加载
    ctx.body = contents
      .replace(/(from\s+['"])(?![\.\/])/g, '$1/@modules/') // 将第三方模块匹配出来，然后加上“/@modules/”
      .replace(/process\.env\.NODE_ENV/g, '"development"') // 替换模块中的process对象为开发环境
  }
})

app.listen(3000)
console.log('Server running @ http://localhost:3000')